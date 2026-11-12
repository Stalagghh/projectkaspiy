// Read models for alerts and readings. Server only: never import from a client component.
// Every query is parameterized; output is validated against the shared contracts.
import { alertDtoSchema, readingDtoSchema, type AlertDto, type ReadingDto } from '@ecoshield/contracts';
import { getPool } from '@ecoshield/db';

const ALERT_SELECT = `
  SELECT a.id, a.kind, a.severity, a.status, a.priority, a.priority_reasons,
         a.event_at, a.created_at, a.updated_at, a.version, a.area_id,
         a.zone_id, z.name_ru AS zone_name, a.device_id, d.name_ru AS device_name,
         ST_X(a.location) AS lon, ST_Y(a.location) AS lat,
         a.is_simulated, a.clip_id, a.related_alert_id,
         det.id AS detection_id, det.label, det.confidence, det.qualitative, det.top_classes,
         det.model_name, det.model_version, det.threshold
    FROM alerts a
    LEFT JOIN zones z ON z.id = a.zone_id
    LEFT JOIN devices d ON d.id = a.device_id
    LEFT JOIN detections det ON det.id = a.detection_id`;

type AlertRow = {
  id: string;
  kind: string;
  severity: string;
  status: string;
  priority: number;
  priority_reasons: unknown;
  event_at: Date;
  created_at: Date;
  updated_at: Date;
  version: number;
  area_id: string;
  zone_id: string | null;
  zone_name: string | null;
  device_id: string | null;
  device_name: string | null;
  lon: number | null;
  lat: number | null;
  is_simulated: boolean;
  clip_id: string | null;
  related_alert_id: string | null;
  detection_id: string | null;
  label: string | null;
  confidence: number | null;
  qualitative: string | null;
  top_classes: unknown;
  model_name: string | null;
  model_version: string | null;
  threshold: number | null;
};

function toAlertDto(row: AlertRow): AlertDto | null {
  const candidate = {
    id: row.id,
    kind: row.kind,
    severity: row.severity,
    status: row.status,
    priority: row.priority,
    priorityReasons: row.priority_reasons ?? [],
    eventAt: row.event_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    version: row.version,
    areaId: row.area_id,
    zoneId: row.zone_id,
    zoneName: row.zone_name,
    deviceId: row.device_id,
    deviceName: row.device_name,
    location: row.lon !== null && row.lat !== null ? { lon: row.lon, lat: row.lat } : null,
    isSimulated: row.is_simulated,
    clipId: row.clip_id,
    relatedAlertId: row.related_alert_id,
    detection:
      row.detection_id === null
        ? null
        : {
            label: row.label,
            confidence: row.confidence,
            qualitative: row.qualitative,
            topClasses: row.top_classes ?? [],
            modelName: row.model_name,
            modelVersion: row.model_version,
            threshold: row.threshold,
          },
  };
  const parsed = alertDtoSchema.safeParse(candidate);
  if (!parsed.success) {
    console.error(`[alerts] row ${row.id} does not match AlertDto:`, parsed.error.issues);
    return null;
  }
  return parsed.data;
}

/** The 50 newest alerts, most urgent first. */
export async function listAlerts(): Promise<AlertDto[]> {
  const { rows } = await getPool().query<AlertRow>(
    `WITH latest AS (SELECT id FROM alerts ORDER BY created_at DESC LIMIT $1)
     ${ALERT_SELECT}
     WHERE a.id IN (SELECT id FROM latest)
     ORDER BY CASE a.severity WHEN 'critical' THEN 3 WHEN 'warning' THEN 2 ELSE 1 END DESC,
              a.priority DESC, a.created_at DESC`,
    [50],
  );
  return rows.map(toAlertDto).filter((alert): alert is AlertDto => alert !== null);
}

export async function getAlert(id: string): Promise<AlertDto | null> {
  const { rows } = await getPool().query<AlertRow>(`${ALERT_SELECT} WHERE a.id = $1`, [id]);
  const row = rows[0];
  return row ? toAlertDto(row) : null;
}

type ReadingRow = {
  sensor_id: string;
  device_id: string;
  metric: string;
  unit: string;
  value: number;
  ts: Date;
  quality: string;
};

/** The reading named by a NOTIFY payload, or the sensor's latest one if it is gone. */
export async function getReading(sensorId: string, ts: string): Promise<ReadingDto | null> {
  const { rows } = await getPool().query<ReadingRow>(
    `SELECT r.sensor_id, s.device_id, s.metric, s.unit, r.value, r.ts, r.quality
       FROM readings r
       JOIN sensors s ON s.id = r.sensor_id
      WHERE r.sensor_id = $1
      ORDER BY (r.ts = $2::timestamptz) DESC, r.ts DESC
      LIMIT 1`,
    [sensorId, ts],
  );
  const row = rows[0];
  if (!row) return null;
  const parsed = readingDtoSchema.safeParse({
    sensorId: row.sensor_id,
    deviceId: row.device_id,
    metric: row.metric,
    unit: row.unit,
    value: row.value,
    ts: row.ts.toISOString(),
    quality: row.quality,
  });
  if (!parsed.success) {
    console.error(`[readings] sensor ${sensorId} does not match ReadingDto:`, parsed.error.issues);
    return null;
  }
  return parsed.data;
}
