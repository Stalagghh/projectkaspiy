// Message handling: validation, replay protection, storage, classification and alert rules.
import { createHash } from 'node:crypto';

import {
  CORRELATION,
  MAX_CLIP_BYTES,
  audioMessageSchema,
  parseTopic,
  telemetryMessageSchema,
  type AudioMessage,
  type ClassifyResponse,
  type MetricName,
  type TelemetryMessage,
} from '@ecoshield/contracts';
import { getPool } from '@ecoshield/db';
import type pg from 'pg';

import { classifyAudio, type MlConfig } from './ml.ts';
import { checkClip, decideAlert, qualityOf, unclassifiedAlert, type AlertDecision } from './rules.ts';
import { isDark } from './sun.ts';

const DEVICE_KIND = { telemetry: 'water_station', audio: 'acoustic_buoy' } as const;

/** Runs fn inside BEGIN/COMMIT on one pooled connection; rolls back on any error. */
export async function withTransaction<T>(fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const db = await getPool().connect();
  try {
    await db.query('BEGIN');
    const result = await fn(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    db.release();
  }
}

function drop(topic: string, reason: string): void {
  // One line, never the payload (it may be large or contain audio).
  console.warn(`ingest: dropped message on ${topic}: ${reason}`);
}

/**
 * Replay protection and device check in one atomic statement: the row is updated only when the
 * device exists with the expected kind and (bootId, seq) is strictly greater than the stored pair.
 */
async function acceptFromDevice(
  db: pg.PoolClient,
  deviceId: string,
  kind: string,
  bootId: number,
  seq: number,
): Promise<string | null> {
  const updated = await db.query(
    `UPDATE devices SET boot_id = $2, last_seq = $3, last_seen_at = now()
      WHERE id = $1 AND kind = $4
        AND (boot_id IS NULL OR last_seq IS NULL OR boot_id < $2 OR (boot_id = $2 AND last_seq < $3))
      RETURNING id`,
    [deviceId, bootId, seq, kind],
  );
  if (updated.rowCount === 1) return null;
  const found = await db.query<{ kind: string }>('SELECT kind FROM devices WHERE id = $1', [deviceId]);
  const row = found.rows[0];
  if (!row) return 'unknown device';
  if (row.kind !== kind) return `device kind is ${row.kind}, expected ${kind}`;
  return `replayed or old (bootId ${bootId}, seq ${seq})`;
}

/** Entry point for one MQTT message. Resolves when the database work is committed (or the message dropped). */
export async function handleMessage(
  topic: string,
  payload: Buffer,
  onClipStored: (clipId: string) => void,
): Promise<void> {
  const parsed = parseTopic(topic);
  if (!parsed) return drop(topic, 'foreign topic');
  let json: unknown;
  try {
    json = JSON.parse(payload.toString('utf8'));
  } catch {
    return drop(topic, 'invalid JSON');
  }
  if (parsed.kind === 'telemetry') {
    const msg = telemetryMessageSchema.safeParse(json);
    if (!msg.success) return drop(topic, 'telemetry schema validation failed');
    if (msg.data.deviceId !== parsed.deviceId) return drop(topic, 'topic and payload deviceId differ');
    return storeTelemetry(topic, msg.data);
  }
  const msg = audioMessageSchema.safeParse(json);
  if (!msg.success) return drop(topic, 'audio schema validation failed');
  if (msg.data.deviceId !== parsed.deviceId) return drop(topic, 'topic and payload deviceId differ');
  const clipId = await storeAudio(topic, msg.data);
  if (clipId) onClipStored(clipId);
}

async function storeTelemetry(topic: string, msg: TelemetryMessage): Promise<void> {
  const sensorIds: string[] = [];
  const values: number[] = [];
  const qualities: string[] = [];
  for (const [metric, value] of Object.entries(msg.readings) as [MetricName, number | undefined][]) {
    if (value === undefined) continue;
    sensorIds.push(`${msg.deviceId}.${metric}`);
    values.push(value);
    qualities.push(qualityOf(metric, value));
  }
  const rejected = await withTransaction(async (db) => {
    const reason = await acceptFromDevice(db, msg.deviceId, DEVICE_KIND.telemetry, msg.bootId, msg.seq);
    if (reason) return reason;
    // Readings of sensors that are not registered are skipped (the JOIN), never inserted blindly.
    await db.query(
      `INSERT INTO readings (sensor_id, ts, value, quality)
       SELECT v.sensor_id, $1::timestamptz, v.value, v.quality
         FROM unnest($2::text[], $3::float8[], $4::text[]) AS v(sensor_id, value, quality)
         JOIN sensors s ON s.id = v.sensor_id
       ON CONFLICT (sensor_id, ts) DO NOTHING`,
      [msg.ts, sensorIds, values, qualities],
    );
    return null;
  });
  if (rejected) drop(topic, rejected);
}

/** Stores the clip as "pending" and returns its id, or null when the message was dropped. */
async function storeAudio(topic: string, msg: AudioMessage): Promise<string | null> {
  const bytes = Buffer.from(msg.clip.dataB64, 'base64');
  const problem = checkClip(bytes, MAX_CLIP_BYTES);
  if (problem) {
    drop(topic, problem);
    return null;
  }
  if (createHash('sha256').update(bytes).digest('hex') !== msg.clip.sha256) {
    drop(topic, 'sha256 mismatch');
    return null;
  }
  const result = await withTransaction(async (db) => {
    const reason = await acceptFromDevice(db, msg.deviceId, DEVICE_KIND.audio, msg.bootId, msg.seq);
    if (reason) return { reason, clipId: null };
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO audio_clips (source, device_id, boot_id, seq, area_id, location, recorded_at, duration_s,
                                sample_rate, sha256, mime, audio, status, is_simulated, scenario_run_id)
       SELECT 'device', d.id, $2, $3, d.area_id, d.location, $4, $5, $6, $7, 'audio/wav', $8, 'pending', $9, $10
         FROM devices d WHERE d.id = $1
       ON CONFLICT (device_id, boot_id, seq) DO NOTHING
       RETURNING id`,
      [
        msg.deviceId,
        msg.bootId,
        msg.seq,
        msg.ts,
        msg.clip.durationS,
        msg.clip.sampleRate,
        msg.clip.sha256,
        bytes,
        msg.simulated,
        msg.scenario?.runId ?? null,
      ],
    );
    return { reason: null, clipId: inserted.rows[0]?.id ?? null };
  });
  if (result.reason) drop(topic, result.reason);
  return result.clipId;
}

type ClipRow = {
  id: string;
  audio: Buffer;
  recorded_at: Date;
  lon: number | null;
  lat: number | null;
  status: string;
};

/**
 * Sends a stored clip to the ML service and applies the alert rules in one transaction.
 * If the ML call fails, the clip waits as "awaiting_ml" and an "unclassified" alert is raised.
 */
export async function classifyClip(ml: MlConfig, clipId: string): Promise<void> {
  const loaded = await getPool().query<ClipRow>(
    `SELECT id, audio, recorded_at, ST_X(location) AS lon, ST_Y(location) AS lat, status
       FROM audio_clips WHERE id = $1`,
    [clipId],
  );
  const clip = loaded.rows[0];
  if (!clip || clip.status === 'done' || clip.status === 'failed') return;

  const startedMs = Date.now();
  let result: ClassifyResponse;
  try {
    result = await classifyAudio(ml, clip.audio);
  } catch (error) {
    await markAwaitingMl(clipId, (error as Error).message);
    return;
  }

  const alert = await withTransaction(async (db) => {
    // Lock the clip so a retry running at the same time cannot classify it twice.
    const locked = await db.query<{ status: string }>('SELECT status FROM audio_clips WHERE id = $1 FOR UPDATE', [
      clipId,
    ]);
    if (locked.rows[0]?.status === 'done') return null;

    const label = result.summary.label;
    const event = result.events
      .filter((e) => e.label === label)
      .sort((a, b) => b.confidence - a.confidence)[0];
    const threshold = label === 'background' ? 0 : result.thresholds[label];
    const detection = await db.query<{ id: string }>(
      `INSERT INTO detections (clip_id, label, confidence, qualitative, start_s, end_s, top_classes,
                               model_name, model_version, threshold)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10) RETURNING id`,
      [
        clipId,
        label,
        result.summary.confidence,
        result.summary.qualitative,
        event?.startS ?? null,
        event?.endS ?? null,
        JSON.stringify(result.summary.topK),
        result.model.name,
        result.model.version,
        threshold,
      ],
    );
    const detectionId = detection.rows[0]?.id as string;
    await db.query(
      `UPDATE audio_clips SET status = 'done', error = NULL, duration_s = $2, sample_rate = $3,
              spectrogram_png = $4 WHERE id = $1`,
      [
        clipId,
        result.durationS,
        result.sampleRate,
        result.spectrogramPng ? Buffer.from(result.spectrogramPng, 'base64') : null,
      ],
    );

    const zone = await db.query<{ id: string }>(
      `SELECT z.id FROM zones z JOIN audio_clips c ON c.id = $1
        WHERE z.kind = 'no_entry' AND ST_Contains(z.geom, c.location)
        ORDER BY z.id LIMIT 1`,
      [clipId],
    );
    const zoneId = zone.rows[0]?.id ?? null;
    let relatedAlertId: string | null = null;
    if (label === 'gunshot') {
      const boat = await db.query<{ id: string }>(
        `SELECT a.id FROM alerts a JOIN audio_clips c ON c.id = $1
          WHERE a.kind IN ('boat_in_no_entry_zone', 'boat_detected')
            AND a.status IN ('new', 'acknowledged', 'assigned')
            AND a.is_simulated = c.is_simulated
            AND abs(extract(epoch FROM (a.event_at - c.recorded_at))) <= $2 * 60
            AND ST_DWithin(a.location::geography, c.location::geography, $3 * 1000)
          ORDER BY a.event_at DESC LIMIT 1`,
        [clipId, CORRELATION.windowMinutes, CORRELATION.radiusKm],
      );
      relatedAlertId = boat.rows[0]?.id ?? null;
    }
    const dark = clip.lat !== null && clip.lon !== null && isDark(clip.recorded_at, clip.lat, clip.lon);
    const decision = decideAlert({
      label,
      confidence: result.summary.confidence,
      inNoEntryZone: zoneId !== null,
      isDark: dark,
      correlatedWithBoat: relatedAlertId !== null,
    });

    // Degraded mode left an "unclassified" alert for this clip: update it instead of adding a new one.
    const existing = await db.query<{ id: string }>(
      `SELECT id FROM alerts WHERE clip_id = $1 AND kind = 'acoustic_unclassified' ORDER BY created_at LIMIT 1 FOR UPDATE`,
      [clipId],
    );
    const existingId = existing.rows[0]?.id ?? null;
    if (!decision) {
      if (existingId) {
        await db.query(
          `UPDATE alerts SET detection_id = $2, version = version + 1, updated_at = now(),
                  status = CASE WHEN status = 'new' THEN 'resolved' ELSE status END,
                  resolved_at = CASE WHEN status = 'new' THEN now() ELSE resolved_at END,
                  resolution_note = CASE WHEN status = 'new' THEN $3 ELSE resolution_note END
            WHERE id = $1`,
          [existingId, detectionId, 'Classified as background by the ML service'],
        );
      }
      return { label, alertId: existingId, decision: null };
    }
    const alertId = existingId
      ? await updateAlert(db, existingId, decision, zoneId, detectionId, relatedAlertId)
      : await insertAlert(db, clipId, decision, zoneId, detectionId, relatedAlertId);
    return { label, alertId, decision };
  });
  if (alert) {
    const what = alert.decision ? `${alert.decision.kind} priority ${alert.decision.priority}` : 'no alert';
    console.log(`ingest: clip ${clipId} -> ${alert.label}, ${what} (ML ${Date.now() - startedMs} ms)`);
  }
}

async function insertAlert(
  db: pg.PoolClient,
  clipId: string,
  decision: AlertDecision,
  zoneId: string | null,
  detectionId: string | null,
  relatedAlertId: string | null,
): Promise<string> {
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO alerts (area_id, zone_id, kind, severity, priority, priority_reasons, location, device_id,
                         clip_id, detection_id, related_alert_id, event_at, is_simulated)
     SELECT c.area_id, $2, $3, $4, $5, $6::jsonb, c.location, c.device_id, c.id, $7, $8, c.recorded_at, c.is_simulated
       FROM audio_clips c WHERE c.id = $1
     RETURNING id`,
    [
      clipId,
      zoneId,
      decision.kind,
      decision.severity,
      decision.priority,
      JSON.stringify(decision.reasons),
      detectionId,
      relatedAlertId,
    ],
  );
  return inserted.rows[0]?.id as string;
}

async function updateAlert(
  db: pg.PoolClient,
  alertId: string,
  decision: AlertDecision,
  zoneId: string | null,
  detectionId: string,
  relatedAlertId: string | null,
): Promise<string> {
  await db.query(
    `UPDATE alerts SET kind = $2, severity = $3, priority = $4, priority_reasons = $5::jsonb, zone_id = $6,
            detection_id = $7, related_alert_id = $8, version = version + 1, updated_at = now()
      WHERE id = $1`,
    [alertId, decision.kind, decision.severity, decision.priority, JSON.stringify(decision.reasons), zoneId, detectionId, relatedAlertId],
  );
  return alertId;
}

/** Degraded mode: keep the clip for a retry and raise one "unclassified acoustic event" alert at once. */
async function markAwaitingMl(clipId: string, reason: string): Promise<void> {
  const created = await withTransaction(async (db) => {
    const locked = await db.query<{ status: string }>('SELECT status FROM audio_clips WHERE id = $1 FOR UPDATE', [
      clipId,
    ]);
    if (locked.rows[0]?.status === 'done') return false;
    await db.query(`UPDATE audio_clips SET status = 'awaiting_ml', error = $2 WHERE id = $1`, [clipId, reason]);
    const existing = await db.query('SELECT 1 FROM alerts WHERE clip_id = $1', [clipId]);
    if (existing.rowCount) return false;
    await insertAlert(db, clipId, unclassifiedAlert(), null, null, null);
    return true;
  });
  console.warn(`ingest: ML unavailable for clip ${clipId} (${reason}); awaiting_ml${created ? ', unclassified alert raised' : ''}`);
}

/** Clips to (re)classify: waiting for ML, or left "pending" by a crash more than a minute ago. */
export async function clipsToRetry(): Promise<string[]> {
  const rows = await getPool().query<{ id: string }>(
    `SELECT id FROM audio_clips
      WHERE status = 'awaiting_ml' OR (status = 'pending' AND received_at < now() - interval '60 seconds')
      ORDER BY recorded_at LIMIT 20`,
  );
  return rows.rows.map((r) => r.id);
}
