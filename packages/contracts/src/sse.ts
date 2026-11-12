// Server-Sent Events from GET /api/stream.
// Wire format: "event: <type>\ndata: <json>\n\n"; a comment line ": ping" every 15 s.
// On reconnect the browser reloads the alert list (no replay buffer in Milestone A).
import { z } from 'zod';

import { alertDtoSchema, readingDtoSchema } from './dto.ts';

export const alertEventSchema = z.object({
  op: z.enum(['created', 'updated']),
  alert: alertDtoSchema,
});
export type AlertEvent = z.infer<typeof alertEventSchema>;

export const readingEventSchema = readingDtoSchema;

export const SSE_EVENT = { alert: 'alert', reading: 'reading' } as const;
export const SSE_PING_SECONDS = 15;

/** Postgres NOTIFY channels that the web server listens to (see packages/db migrations). */
export const PG_CHANNELS = { alertChanges: 'alert_changes', readings: 'readings' } as const;
