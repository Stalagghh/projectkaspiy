// Shape of GET /api/forecast, shared by the route handler (which validates what it reads
// from the database) and the /forecast page (which validates what it receives).
import { dataSourceSchema, forecastFactorSchema } from '@ecoshield/contracts';
import { z } from 'zod';

export const forecastLevelSchema = z.enum(['low', 'medium', 'high']);
export type ForecastLevel = z.infer<typeof forecastLevelSchema>;

export const isoDateSchema = z.iso.date();

/** One day of area-average model inputs, as stored in forecast_runs.hydrology. */
export const hydrologyDaySchema = z.object({
  date: isoDateSchema,
  windSpeedMs: z.number(),
  waveHeightM: z.number(),
  sstC: z.number(),
  sources: z.object({
    wind: dataSourceSchema,
    waves: dataSourceSchema,
    sst: dataSourceSchema,
  }),
});
export type HydrologyDay = z.infer<typeof hydrologyDaySchema>;

/** Plain-language explanation of one day, as stored in forecast_runs.summaries. */
export const summaryDaySchema = z.object({
  date: isoDateSchema,
  summaryRu: z.string(),
  summaryEn: z.string().optional(),
});
export type SummaryDay = z.infer<typeof summaryDaySchema>;

export const cellPropertiesSchema = z.object({
  id: z.number().int(),
  presence: z.number().min(0).max(1),
  level: forecastLevelSchema,
  factors: z.array(forecastFactorSchema),
});
export type CellProperties = z.infer<typeof cellPropertiesSchema>;

const positionSchema = z.array(z.number()).min(2);
const polygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(positionSchema)),
});

export const cellFeatureSchema = z.object({
  type: z.literal('Feature'),
  id: z.number().int(),
  geometry: polygonSchema,
  properties: cellPropertiesSchema,
});
export type CellFeature = z.infer<typeof cellFeatureSchema>;

export const cellCollectionSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(cellFeatureSchema),
});
export type CellCollection = z.infer<typeof cellCollectionSchema>;

export const forecastApiResponseSchema = z.object({
  run: z.object({
    id: z.uuid(),
    issuedAt: z.string(),
    startDate: isoDateSchema,
    days: z.number().int().min(1),
    /** All days of the run, from startDate, as YYYY-MM-DD. */
    dates: z.array(isoDateSchema),
    modelName: z.string(),
    modelVersion: z.string(),
    assumptions: z.array(z.string()),
    hydrology: z.array(hydrologyDaySchema),
    summaries: z.array(summaryDaySchema),
  }),
  day: isoDateSchema,
  cells: cellCollectionSchema,
  /** Names of run fields that were stored in an unexpected shape and are left out. */
  warnings: z.array(z.string()),
});
export type ForecastApiResponse = z.infer<typeof forecastApiResponseSchema>;

export const forecastErrorSchema = z.object({ error: z.string() });

/** Legend classes of the presence index. Breaks match the colour ramp in the map layer. */
export const PRESENCE_CLASSES = [
  { level: 'low', from: 0, to: 0.33, labelRu: 'низкая' },
  { level: 'medium', from: 0.33, to: 0.66, labelRu: 'средняя' },
  { level: 'high', from: 0.66, to: 1, labelRu: 'высокая' },
] as const satisfies ReadonlyArray<{ level: ForecastLevel; from: number; to: number; labelRu: string }>;

/** Colour stops of the presence ramp: transparent navy, teal, pale yellow, international orange. */
export const PRESENCE_RAMP = [
  { at: 0, color: '#12263A', opacity: 0.12 },
  { at: 0.33, color: '#1FA39A', opacity: 0.5 },
  { at: 0.66, color: '#E3C766', opacity: 0.62 },
  { at: 1, color: '#FF6A13', opacity: 0.8 },
] as const;

export const LEVEL_RU: Record<ForecastLevel, string> = {
  low: 'низкая',
  medium: 'средняя',
  high: 'высокая',
};

export const FACTOR_RU: Record<string, string> = {
  season: 'сезон',
  wind: 'ветер',
  waves: 'волнение',
  sst: 'температура воды',
  haulout: 'близость к залёжке',
};
