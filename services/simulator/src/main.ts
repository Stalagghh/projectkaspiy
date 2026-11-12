// Scenario simulator: publishes simulated water telemetry every 5 s and, on request through its
// control API, the "night poacher" audio scenario. Uses the same MQTT contracts as real devices.
// Run: MQTT_URL=mqtt://127.0.0.1:1884 SIM_CONTROL_TOKEN=... node services/simulator/src/main.ts
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';

import {
  MAX_CLIP_BYTES,
  MAX_CLIP_SECONDS,
  NIGHT_POACHER_STEPS,
  audioMessageSchema,
  audioTopic,
  scenarioRunSchema,
  telemetryMessageSchema,
  telemetryTopic,
  type ScenarioRun,
} from '@ecoshield/contracts';
import mqtt from 'mqtt';
import { z } from 'zod';

import { WATER_STATIONS, simulatedReadings } from './telemetry.ts';
import { parseWav } from './wav.ts';

const envSchema = z.object({
  MQTT_URL: z.string().min(1),
  SIM_CONTROL_TOKEN: z.string().min(1),
  SIMULATOR_PORT: z.coerce.number().int().positive().default(8090),
  DEMO_CLIPS_DIR: z.string().min(1).default('/data/demo'),
  TELEMETRY_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
});

const parsedEnv = envSchema.safeParse(process.env);
if (!parsedEnv.success) {
  const missing = parsedEnv.error.issues.map((i) => i.path.join('.')).join(', ');
  console.error(`simulator: invalid or missing environment variables: ${missing}`);
  process.exit(1);
}
const env = parsedEnv.data;

/** Boot id = process start time in epoch seconds; with seq it makes every message unique. */
const BOOT_ID = Math.floor(Date.now() / 1000);
const seqByDevice = new Map<string, number>();
function nextSeq(deviceId: string): number {
  const seq = (seqByDevice.get(deviceId) ?? -1) + 1;
  seqByDevice.set(deviceId, seq);
  return seq;
}

const client = mqtt.connect(env.MQTT_URL, { clientId: 'simulator', reconnectPeriod: 2000 });
client.on('connect', () => console.log(`simulator: connected to ${env.MQTT_URL}`));
client.on('error', (error) => console.error(`simulator: mqtt error: ${error.message}`));

function publish(topic: string, payload: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    client.publish(topic, JSON.stringify(payload), { qos: 1 }, (error) => (error ? reject(error) : resolve()));
  });
}

// ---- Telemetry loop ----------------------------------------------------------------------------
let tick = 0;
async function publishTelemetry(): Promise<void> {
  if (!client.connected) return; // skip while offline; values are deterministic per tick anyway
  const ts = new Date().toISOString();
  for (const deviceId of WATER_STATIONS) {
    const message = telemetryMessageSchema.parse({
      v: 1,
      deviceId,
      bootId: BOOT_ID,
      seq: nextSeq(deviceId),
      ts,
      simulated: true,
      readings: simulatedReadings(deviceId, tick),
    });
    await publish(telemetryTopic(deviceId), message);
  }
  tick++;
}
setInterval(() => {
  publishTelemetry().catch((error: unknown) =>
    console.error(`simulator: telemetry publish failed: ${(error as Error).message}`),
  );
}, env.TELEMETRY_INTERVAL_MS);

// ---- Scenarios -----------------------------------------------------------------------------------
const runs = new Map<string, ScenarioRun>();

type LoadedClip = { data: Buffer; durationS: number; sha256: string };

/** Reads and checks every clip of the scenario before anything is scheduled. */
async function loadClips(names: readonly string[]): Promise<Map<string, LoadedClip>> {
  const clips = new Map<string, LoadedClip>();
  for (const name of names) {
    const path = join(env.DEMO_CLIPS_DIR, name);
    let data: Buffer;
    try {
      data = await readFile(path);
    } catch {
      throw new ClipError(`clip file missing: ${path}`);
    }
    let info;
    try {
      info = parseWav(data);
    } catch (error) {
      throw new ClipError(`clip ${path} is not a valid WAV: ${(error as Error).message}`);
    }
    if (info.sampleRate !== 16000) throw new ClipError(`clip ${path} must be 16 kHz, got ${info.sampleRate} Hz`);
    if (data.length > MAX_CLIP_BYTES) throw new ClipError(`clip ${path} is larger than ${MAX_CLIP_BYTES} bytes`);
    if (info.durationS <= 0 || info.durationS > MAX_CLIP_SECONDS) {
      throw new ClipError(`clip ${path} duration ${info.durationS.toFixed(2)} s is outside 0..${MAX_CLIP_SECONDS} s`);
    }
    clips.set(name, { data, durationS: info.durationS, sha256: createHash('sha256').update(data).digest('hex') });
  }
  return clips;
}

class ClipError extends Error {}

async function startNightPoacher(): Promise<ScenarioRun> {
  const clips = await loadClips([...new Set(NIGHT_POACHER_STEPS.map((s) => s.clip))]);
  const run: ScenarioRun = scenarioRunSchema.parse({
    runId: randomUUID(),
    scenario: 'night-poacher',
    startedAt: new Date().toISOString(),
    steps: NIGHT_POACHER_STEPS.map((s) => ({ ...s, publishedAt: null })),
  });
  runs.set(run.runId, run);
  run.steps.forEach((step, index) => {
    setTimeout(() => {
      const clip = clips.get(step.clip) as LoadedClip;
      const publishedAt = new Date().toISOString();
      const message = audioMessageSchema.parse({
        v: 1,
        deviceId: step.deviceId,
        bootId: BOOT_ID,
        seq: nextSeq(step.deviceId),
        ts: publishedAt,
        simulated: true,
        clip: {
          format: 'wav',
          sampleRate: 16000,
          durationS: Number(clip.durationS.toFixed(3)),
          sha256: clip.sha256,
          dataB64: clip.data.toString('base64'),
        },
        scenario: { runId: run.runId, step: step.step },
      });
      publish(audioTopic(step.deviceId), message)
        .then(() => {
          const current = run.steps[index];
          if (current) current.publishedAt = publishedAt;
          console.log(`simulator: run ${run.runId} step ${step.step} published at ${publishedAt}`);
        })
        .catch((error: unknown) =>
          console.error(`simulator: run ${run.runId} step ${step.step} failed: ${(error as Error).message}`),
        );
    }, step.offsetS * 1000);
  });
  console.log(`simulator: started run ${run.runId} (night-poacher)`);
  return run;
}

// ---- Control API ---------------------------------------------------------------------------------
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Constant-time token check: compare SHA-256 digests so lengths never differ. */
function authorized(req: IncomingMessage): boolean {
  const header = req.headers.authorization ?? '';
  const given = createHash('sha256').update(header).digest();
  const expected = createHash('sha256').update(`Bearer ${env.SIM_CONTROL_TOKEN}`).digest();
  return timingSafeEqual(given, expected);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/healthz') return sendJson(res, 200, { status: 'ok' });
  if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' });

  const start = /^\/scenarios\/([a-z0-9-]+)\/start$/.exec(url.pathname);
  if (req.method === 'POST' && start) {
    if (start[1] !== 'night-poacher') return sendJson(res, 404, { error: 'unknown scenario' });
    startNightPoacher()
      .then((run) => sendJson(res, 202, run))
      .catch((error: unknown) => {
        if (error instanceof ClipError) return sendJson(res, 409, { error: error.message });
        console.error(`simulator: start failed: ${(error as Error).message}`);
        sendJson(res, 500, { error: 'internal error' });
      });
    return;
  }
  const runMatch = /^\/runs\/([0-9a-f-]{36})$/.exec(url.pathname);
  if (req.method === 'GET' && runMatch) {
    const run = runs.get(runMatch[1] as string);
    return run ? sendJson(res, 200, run) : sendJson(res, 404, { error: 'run not found' });
  }
  sendJson(res, 404, { error: 'not found' });
});
server.listen(env.SIMULATOR_PORT, () => console.log(`simulator: control API on :${env.SIMULATOR_PORT}`));

function shutdown(): void {
  server.close();
  client.end(false, () => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
