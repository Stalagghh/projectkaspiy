// Ingest worker: MQTT -> validation -> Postgres -> ML -> alerts; plus the clip retry loop,
// the seal forecast job and a health endpoint.
// Run: DATABASE_URL=... MQTT_URL=... ML_URL=... ML_API_TOKEN=... node services/ingest/src/main.ts
import { createServer } from 'node:http';

import { SUBSCRIBE_ALL_DEVICES } from '@ecoshield/contracts';
import { closePool, getPool } from '@ecoshield/db';
import mqtt from 'mqtt';

import { loadEnv } from './env.ts';
import { startForecastJob } from './forecast-job.ts';
import { classifyClip, clipsToRetry, handleMessage } from './pipeline.ts';

const env = loadEnv();
const ml = { url: env.ML_URL, token: env.ML_API_TOKEN };
const RETRY_INTERVAL_MS = 10_000;

// ---- Classification queue: one clip at a time, in arrival order -------------------------------------
// Serial processing keeps the alert rules deterministic (a gunshot sees the boat alert created before it).
const queued = new Set<string>();
let queueTail: Promise<void> = Promise.resolve();
function enqueueClip(clipId: string): void {
  if (queued.has(clipId)) return;
  queued.add(clipId);
  queueTail = queueTail.then(async () => {
    try {
      await classifyClip(ml, clipId);
    } catch (error) {
      console.error(`ingest: classification of clip ${clipId} failed: ${(error as Error).message}`);
    } finally {
      queued.delete(clipId);
    }
  });
}

const retryTimer = setInterval(() => {
  clipsToRetry()
    .then((ids) => ids.forEach(enqueueClip))
    .catch((error: unknown) => console.error(`ingest: retry scan failed: ${(error as Error).message}`));
}, RETRY_INTERVAL_MS);

// ---- MQTT ---------------------------------------------------------------------------------------------
// clean: false keeps a persistent session in the broker, so QoS 1 messages that arrive while the worker
// is down (or that were never acknowledged) are delivered again after reconnecting.
const client = mqtt.connect(env.MQTT_URL, { clientId: 'ingest', clean: false, reconnectPeriod: 2000 });

// mqtt.js sends the PUBACK for a QoS 1 message only after client.handleMessage(packet, done) calls
// done() without an error (see node_modules/mqtt/build/lib/handlers/publish.js). We override it so that
// the acknowledgement goes out only after the database transaction of the message has committed.
// On a database error we call done(error): no PUBACK is sent and the broker redelivers the message
// after the next reconnect. Invalid or replayed messages are dropped and acknowledged (done()).
// mqtt.js handles incoming packets one by one, so messages are processed in order.
client.handleMessage = (packet, done) => {
  const payload = typeof packet.payload === 'string' ? Buffer.from(packet.payload) : packet.payload;
  handleMessage(packet.topic, payload, enqueueClip).then(
    () => done(),
    (error: unknown) => {
      console.error(`ingest: database work failed for ${packet.topic}, not acknowledged: ${(error as Error).message}`);
      done(error as Error);
    },
  );
};
client.on('connect', () => {
  console.log(`ingest: connected to ${env.MQTT_URL}`);
  client.subscribe(SUBSCRIBE_ALL_DEVICES, { qos: 1 }, (error) => {
    if (error) console.error(`ingest: subscribe failed: ${error.message}`);
    else console.log(`ingest: subscribed to ${SUBSCRIBE_ALL_DEVICES}`);
  });
});
client.on('error', (error) => console.error(`ingest: mqtt error: ${error.message}`));
client.on('offline', () => console.warn('ingest: mqtt offline, reconnecting'));

// ---- Health -------------------------------------------------------------------------------------------
const health = createServer((req, res) => {
  if (req.method !== 'GET' || req.url !== '/healthz') {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }
  getPool()
    .query('SELECT 1')
    .then(
      () => true,
      () => false,
    )
    .then((db) => {
      const mqttOk = client.connected;
      const ok = db && mqttOk;
      res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: ok ? 'ok' : 'degraded', mqtt: mqttOk, db }));
    });
});
health.listen(env.INGEST_HEALTH_PORT, () => console.log(`ingest: health on :${env.INGEST_HEALTH_PORT}/healthz`));

const forecastJob = startForecastJob(ml, env.FORECAST_FIRST_DELAY_MS);

// Pick up clips left over from a previous run right away.
clipsToRetry()
  .then((ids) => ids.forEach(enqueueClip))
  .catch((error: unknown) => console.error(`ingest: initial retry scan failed: ${(error as Error).message}`));

function shutdown(): void {
  clearInterval(retryTimer);
  forecastJob.stop();
  health.close();
  client.end(false, () => {
    queueTail.finally(() => closePool().finally(() => process.exit(0)));
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
