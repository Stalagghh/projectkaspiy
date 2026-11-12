// MQTT contract between devices (real or simulated) and the ingest worker.
// Topic layout: ecoshield/v1/{deviceId}/{kind}. A device publishes only to its own topics.
import { z } from 'zod';

export const TOPIC_PREFIX = 'ecoshield/v1';
export const telemetryTopic = (deviceId: string): string => `${TOPIC_PREFIX}/${deviceId}/telemetry`;
export const audioTopic = (deviceId: string): string => `${TOPIC_PREFIX}/${deviceId}/audio`;
/** Subscription used by the ingest worker. */
export const SUBSCRIBE_ALL_DEVICES = `${TOPIC_PREFIX}/+/+`;

/** Parses a topic into device id and message kind; returns null for foreign topics. */
export function parseTopic(topic: string): { deviceId: string; kind: 'telemetry' | 'audio' } | null {
  const match = /^ecoshield\/v1\/([a-z0-9][a-z0-9-]{1,31})\/(telemetry|audio)$/.exec(topic);
  if (!match) return null;
  return { deviceId: match[1] as string, kind: match[2] as 'telemetry' | 'audio' };
}

export const deviceIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,31}$/);

/** Water quality metrics with physically plausible ranges. Outside the range = "suspect". */
export const METRICS = {
  water_temp_c: { unit: '°C', validMin: -2, validMax: 40 },
  conductivity_us_cm: { unit: 'µS/cm', validMin: 0, validMax: 60000 },
  turbidity_ntu: { unit: 'NTU', validMin: 0, validMax: 4000 },
} as const;
export type MetricName = keyof typeof METRICS;
export const metricNameSchema = z.enum(['water_temp_c', 'conductivity_us_cm', 'turbidity_ntu']);

// Fields every device message carries. (bootId, seq) grows strictly per device: replay protection.
const envelope = {
  v: z.literal(1),
  deviceId: deviceIdSchema,
  bootId: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  ts: z.iso.datetime({ offset: true }),
  simulated: z.boolean(),
};

export const telemetryMessageSchema = z.object({
  ...envelope,
  readings: z
    .object({
      water_temp_c: z.number().finite().optional(),
      conductivity_us_cm: z.number().finite().optional(),
      turbidity_ntu: z.number().finite().optional(),
    })
    .refine((r) => Object.keys(r).length > 0, 'at least one reading is required'),
});
export type TelemetryMessage = z.infer<typeof telemetryMessageSchema>;

/** Largest decoded audio clip accepted over MQTT (bytes). */
export const MAX_CLIP_BYTES = 1_000_000;
export const MAX_CLIP_SECONDS = 30;

export const audioMessageSchema = z.object({
  ...envelope,
  clip: z.object({
    format: z.literal('wav'),
    sampleRate: z.literal(16000),
    durationS: z.number().positive().max(MAX_CLIP_SECONDS),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    dataB64: z.string().max(Math.ceil(MAX_CLIP_BYTES / 3) * 4),
  }),
  /** Present only for messages sent by the scenario simulator. */
  scenario: z.object({ runId: z.uuid(), step: z.string() }).optional(),
});
export type AudioMessage = z.infer<typeof audioMessageSchema>;
