// Data transfer objects that the web server sends to the browser (pages, API, SSE),
// plus the alert rules shared by the ingest worker (which sets them) and the UI (which explains them).
import { z } from 'zod';

import { audioLabelSchema, classScoreSchema, qualitativeSchema } from './ml.ts';
import { metricNameSchema } from './mqtt.ts';

export const severitySchema = z.enum(['info', 'warning', 'critical']);
export type Severity = z.infer<typeof severitySchema>;

export const alertStatusSchema = z.enum([
  'new',
  'acknowledged',
  'assigned',
  'resolved',
  'false_positive',
]);
export type AlertStatus = z.infer<typeof alertStatusSchema>;

export const alertKindSchema = z.enum([
  'gunshot',
  'boat_in_no_entry_zone',
  'boat_detected',
  'acoustic_unclassified',
]);
export type AlertKind = z.infer<typeof alertKindSchema>;

/** Why an alert got its priority. Stored in alerts.priority_reasons. */
export const priorityReasonSchema = z.object({
  code: z.enum(['severity', 'confidence', 'no_entry_zone', 'correlated_gunshot', 'darkness']),
  points: z.number(),
});
export type PriorityReason = z.infer<typeof priorityReasonSchema>;

/** Priority = severity base + confidence weight + bonuses. Kept simple so it can be explained. */
export const PRIORITY_POINTS = {
  severity: { info: 10, warning: 50, critical: 100 },
  confidenceWeight: 20,
  noEntryZone: 10,
  correlatedGunshot: 20,
  darkness: 10,
} as const;

/** A gunshot within this time and distance of an open boat alert is linked to it. */
export const CORRELATION = { windowMinutes: 15, radiusKm: 3 } as const;

export const pointSchema = z.object({ lon: z.number(), lat: z.number() });

export const alertDtoSchema = z.object({
  id: z.uuid(),
  kind: alertKindSchema,
  severity: severitySchema,
  status: alertStatusSchema,
  priority: z.number().int(),
  priorityReasons: z.array(priorityReasonSchema),
  /** Time of the underlying event (audio clip timestamp from the device). */
  eventAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int(),
  areaId: z.string(),
  zoneId: z.string().nullable(),
  zoneName: z.string().nullable(),
  deviceId: z.string().nullable(),
  deviceName: z.string().nullable(),
  location: pointSchema.nullable(),
  isSimulated: z.boolean(),
  clipId: z.uuid().nullable(),
  relatedAlertId: z.uuid().nullable(),
  detection: z
    .object({
      label: audioLabelSchema,
      confidence: z.number().min(0).max(1),
      qualitative: qualitativeSchema,
      topClasses: z.array(classScoreSchema),
      modelName: z.string(),
      modelVersion: z.string(),
      threshold: z.number(),
    })
    .nullable(),
});
export type AlertDto = z.infer<typeof alertDtoSchema>;

export const readingDtoSchema = z.object({
  sensorId: z.string(),
  deviceId: z.string(),
  metric: metricNameSchema,
  unit: z.string(),
  value: z.number(),
  ts: z.string(),
  quality: z.enum(['ok', 'suspect']),
});
export type ReadingDto = z.infer<typeof readingDtoSchema>;

/** Body of the alert actions (Server Actions / API). Optimistic locking by version. */
export const alertActionSchema = z.object({
  alertId: z.uuid(),
  version: z.number().int().positive(),
  note: z.string().max(500).optional(),
});
export type AlertAction = z.infer<typeof alertActionSchema>;

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: 'invalid' | 'not_found' | 'conflict' | 'forbidden' };
