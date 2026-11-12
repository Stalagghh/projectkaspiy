// HTTP contract of the ML service (services/ml, FastAPI). The Pydantic models in
// services/ml mirror these schemas field by field; callers validate responses with them.
// All endpoints except /healthz require "Authorization: Bearer <ML_API_TOKEN>".
import { z } from 'zod';

export const audioLabelSchema = z.enum(['boat_engine', 'gunshot', 'background']);
export type AudioLabel = z.infer<typeof audioLabelSchema>;
export const qualitativeSchema = z.enum(['high', 'medium', 'low']);

export const classScoreSchema = z.object({ name: z.string(), score: z.number().min(0).max(1) });

export const modelInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  sha256: z.string(),
  labelMapVersion: z.string(),
});

/** GET /healthz */
export const mlHealthSchema = z.object({
  status: z.literal('ok'),
  modelLoaded: z.boolean(),
  model: modelInfoSchema,
});

/**
 * POST /v1/audio/classify?topK=5&spectrogram=true
 * Body: raw audio bytes (wav, mp3, flac or ogg), Content-Type: application/octet-stream.
 * Errors: 401 token, 413 too large (> 10 MB), 415 unknown type (magic bytes),
 * 422 cannot decode or longer than 60 s, 504 processing timeout (15 s).
 */
export const classifyResponseSchema = z.object({
  model: modelInfoSchema,
  durationS: z.number().nonnegative(),
  sampleRate: z.number().int().positive(),
  windows: z.array(
    z.object({
      startS: z.number(),
      endS: z.number(),
      scores: z.object({
        boat_engine: z.number().min(0).max(1),
        gunshot: z.number().min(0).max(1),
        background: z.number().min(0).max(1),
      }),
      topK: z.array(classScoreSchema),
    }),
  ),
  events: z.array(
    z.object({
      label: z.enum(['boat_engine', 'gunshot']),
      confidence: z.number().min(0).max(1),
      startS: z.number(),
      endS: z.number(),
    }),
  ),
  summary: z.object({
    label: audioLabelSchema,
    confidence: z.number().min(0).max(1),
    qualitative: qualitativeSchema,
    topK: z.array(classScoreSchema),
  }),
  /** Preliminary thresholds until they are tuned on a validation set (MODEL_CARD). */
  thresholds: z.object({ boat_engine: z.number(), gunshot: z.number() }),
  /** Log-mel spectrogram as base64 PNG, or null when spectrogram=false. */
  spectrogramPng: z.string().nullable(),
});
export type ClassifyResponse = z.infer<typeof classifyResponseSchema>;

export const dataSourceSchema = z.object({
  name: z.string(),
  kind: z.enum(['real', 'synthetic']),
  asOf: z.string(),
});

export const forecastFactorNameSchema = z.enum(['season', 'wind', 'waves', 'sst', 'haulout']);

/** POST /v1/forecast/seal: simplified transparent seal presence model (PLAN.md section 7). */
export const forecastRequestSchema = z.object({
  areaId: z.string(),
  issuedAt: z.iso.datetime({ offset: true }),
  startDate: z.iso.date(),
  days: z.number().int().min(1).max(7),
  cells: z.array(
    z.object({
      id: z.number().int(),
      lat: z.number(),
      lon: z.number(),
      distHauloutKm: z.number().nonnegative(),
      distCoastKm: z.number().nonnegative(),
    }),
  ),
  /** One record per day for the whole area (area-average inputs). */
  hydrology: z.array(
    z.object({
      date: z.iso.date(),
      windSpeedMs: z.number().nonnegative(),
      waveHeightM: z.number().nonnegative(),
      sstC: z.number(),
      sources: z.object({
        wind: dataSourceSchema,
        waves: dataSourceSchema,
        sst: dataSourceSchema,
      }),
    }),
  ),
});
export type ForecastRequest = z.infer<typeof forecastRequestSchema>;

export const forecastFactorSchema = z.object({
  name: forecastFactorNameSchema,
  value: z.number(),
  unit: z.string(),
  /** Contribution to the presence log-odds; positive raises presence. */
  contribution: z.number(),
});

export const forecastResponseSchema = z.object({
  model: z.object({ name: z.string(), version: z.string(), simplified: z.literal(true) }),
  days: z.array(
    z.object({
      date: z.iso.date(),
      cells: z.array(
        z.object({
          id: z.number().int(),
          presence: z.number().min(0).max(1),
          level: z.enum(['low', 'medium', 'high']),
          factors: z.array(forecastFactorSchema),
        }),
      ),
      summaryRu: z.string(),
      summaryEn: z.string(),
    }),
  ),
  /** Assumption ids from PLAN.md section 7.3 that the model relies on. */
  assumptions: z.array(z.string()),
});
export type ForecastResponse = z.infer<typeof forecastResponseSchema>;
