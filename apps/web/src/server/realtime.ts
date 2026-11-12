// One shared LISTEN connection per server process, fanned out to every SSE client.
// Postgres payloads carry identifiers only; we load the DTOs ourselves.
// If the LISTEN connection ends, open SSE streams are closed (browsers reconnect and
// reload the alert list, since there is no replay buffer) and we reconnect with backoff.
import type pg from 'pg';
import { z } from 'zod';

import { PG_CHANNELS, SSE_EVENT, type AlertEvent, type ReadingDto } from '@ecoshield/contracts';
import { connectListener } from '@ecoshield/db';

import { getAlert, getReading } from '@/features/alerts/server/queries';

export type StreamEvent =
  | { type: typeof SSE_EVENT.alert; data: AlertEvent }
  | { type: typeof SSE_EVENT.reading; data: ReadingDto };

export type Subscriber = {
  send: (event: StreamEvent) => void;
  /** Called when the upstream LISTEN connection is lost. */
  close: () => void;
};

type Hub = {
  subscribers: Set<Subscriber>;
  client: pg.Client | null;
  connecting: Promise<void> | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  retryMs: number;
};

const alertPayload = z.object({ id: z.uuid(), op: z.enum(['insert', 'update']) });
const readingPayload = z.object({ sensorId: z.string(), ts: z.string() });

// Kept on globalThis so that dev hot reloads do not open a second LISTEN connection.
const globalRef = globalThis as typeof globalThis & { __ecoshieldRealtimeHub?: Hub };
const hub: Hub = (globalRef.__ecoshieldRealtimeHub ??= {
  subscribers: new Set(),
  client: null,
  connecting: null,
  retryTimer: null,
  retryMs: 1000,
});

function broadcast(event: StreamEvent): void {
  for (const subscriber of hub.subscribers) subscriber.send(event);
}

async function handleNotification(message: pg.Notification): Promise<void> {
  let payload: unknown;
  try {
    payload = JSON.parse(message.payload ?? '');
  } catch {
    return;
  }
  if (message.channel === PG_CHANNELS.alertChanges) {
    const parsed = alertPayload.safeParse(payload);
    if (!parsed.success) return;
    const alert = await getAlert(parsed.data.id);
    if (!alert) return;
    broadcast({
      type: SSE_EVENT.alert,
      data: { op: parsed.data.op === 'insert' ? 'created' : 'updated', alert },
    });
  } else if (message.channel === PG_CHANNELS.readings) {
    const parsed = readingPayload.safeParse(payload);
    if (!parsed.success) return;
    const reading = await getReading(parsed.data.sensorId, parsed.data.ts);
    if (reading) broadcast({ type: SSE_EVENT.reading, data: reading });
  }
}

function scheduleReconnect(): void {
  if (hub.retryTimer || hub.client) return;
  const delay = hub.retryMs;
  hub.retryMs = Math.min(hub.retryMs * 2, 30_000);
  hub.retryTimer = setTimeout(() => {
    hub.retryTimer = null;
    void ensureListening();
  }, delay);
}

function onConnectionLost(client: pg.Client): void {
  if (hub.client !== client) return;
  hub.client = null;
  client.removeAllListeners();
  client.end().catch(() => undefined);
  // Close every open stream: browsers reconnect and reload the list.
  for (const subscriber of [...hub.subscribers]) subscriber.close();
  scheduleReconnect();
}

async function connect(): Promise<void> {
  const client = await connectListener();
  client.on('notification', (message) => {
    handleNotification(message).catch((error: unknown) => {
      console.error('[realtime] failed to handle notification', error);
    });
  });
  client.on('error', (error) => {
    console.error('[realtime] LISTEN connection error', error.message);
    onConnectionLost(client);
  });
  client.on('end', () => onConnectionLost(client));
  try {
    await client.query(`LISTEN ${PG_CHANNELS.alertChanges}`);
    await client.query(`LISTEN ${PG_CHANNELS.readings}`);
  } catch (error) {
    client.removeAllListeners();
    await client.end().catch(() => undefined);
    throw error;
  }
  hub.client = client;
  hub.retryMs = 1000;
}

/** Opens the LISTEN connection if needed. Resolves once listening, rejects on failure. */
export function ensureListening(): Promise<void> {
  if (hub.client) return Promise.resolve();
  hub.connecting ??= connect()
    .catch((error: unknown) => {
      console.error('[realtime] cannot LISTEN:', error instanceof Error ? error.message : error);
      scheduleReconnect();
      throw error;
    })
    .finally(() => {
      hub.connecting = null;
    });
  return hub.connecting;
}

export function subscribe(subscriber: Subscriber): () => void {
  hub.subscribers.add(subscriber);
  return () => {
    hub.subscribers.delete(subscriber);
  };
}
