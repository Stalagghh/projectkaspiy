// Reads the latest seal-presence forecast run and the cells of one day from PostgreSQL.
// Every query is parameterized; geometry is converted to GeoJSON by PostGIS.
import { forecastFactorSchema } from '@ecoshield/contracts';
import { getPool } from '@ecoshield/db';
import { z } from 'zod';

import {
  type ForecastApiResponse,
  forecastApiResponseSchema,
  hydrologyDaySchema,
  summaryDaySchema,
} from '../schema';

export const FORECAST_AREA_ID = 'agrakhan';

type RunRow = {
  id: string;
  issued_at: Date;
  start_date: string;
  days: number;
  model_name: string;
  model_version: string;
  hydrology: unknown;
  summaries: unknown;
  assumptions: unknown;
};

type CellRow = {
  id: number;
  presence: number;
  level: string;
  factors: unknown;
  geometry: unknown;
};

export type ForecastResult =
  | { kind: 'ok'; data: ForecastApiResponse }
  | { kind: 'no_forecast' }
  | { kind: 'day_out_of_range'; dates: string[] };

/** YYYY-MM-DD dates of a run, computed in UTC so the server time zone does not matter. */
export function runDates(startDate: string, days: number): string[] {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) =>
    new Date(start + i * 86_400_000).toISOString().slice(0, 10),
  );
}

/**
 * Parses a JSON column that the forecast job writes. A column in an unexpected shape is
 * left out (empty list) and reported in `warnings`, so the map still shows the real cells.
 */
function parseColumn<T>(
  name: string,
  value: unknown,
  schema: z.ZodType<T[]>,
  warnings: string[],
): T[] {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  warnings.push(name);
  console.warn(`[forecast] run column "${name}" has an unexpected shape`, z.prettifyError(parsed.error));
  return [];
}

export async function getLatestForecast(day: string | undefined): Promise<ForecastResult> {
  const pool = getPool();
  const runs = await pool.query<RunRow>(
    `SELECT id, issued_at, to_char(start_date, 'YYYY-MM-DD') AS start_date, days,
            model_name, model_version, hydrology, summaries, assumptions
       FROM forecast_runs
      WHERE area_id = $1
      ORDER BY issued_at DESC
      LIMIT 1`,
    [FORECAST_AREA_ID],
  );
  const run = runs.rows[0];
  if (!run) return { kind: 'no_forecast' };

  const dates = runDates(run.start_date, run.days);
  const selectedDay = day ?? dates[0];
  if (!selectedDay || !dates.includes(selectedDay)) return { kind: 'day_out_of_range', dates };

  const cells = await pool.query<CellRow>(
    `SELECT v.cell_id AS id, v.presence, v.level, v.factors,
            ST_AsGeoJSON(c.geom, 6)::json AS geometry
       FROM forecast_values v
       JOIN forecast_cells c ON c.id = v.cell_id
      WHERE v.run_id = $1 AND v.day = $2::date
      ORDER BY v.cell_id`,
    [run.id, selectedDay],
  );

  const warnings: string[] = [];
  const hydrology = parseColumn('hydrology', run.hydrology, z.array(hydrologyDaySchema), warnings);
  const summaries = parseColumn('summaries', run.summaries, z.array(summaryDaySchema), warnings);
  const assumptions = parseColumn('assumptions', run.assumptions, z.array(z.string()), warnings);

  const response = {
    run: {
      id: run.id,
      issuedAt: run.issued_at.toISOString(),
      startDate: run.start_date,
      days: run.days,
      dates,
      modelName: run.model_name,
      modelVersion: run.model_version,
      assumptions,
      hydrology,
      summaries,
    },
    day: selectedDay,
    cells: {
      type: 'FeatureCollection' as const,
      features: cells.rows.map((row) => ({
        type: 'Feature' as const,
        id: row.id,
        geometry: row.geometry,
        properties: {
          id: row.id,
          presence: row.presence,
          level: row.level,
          factors: z.array(forecastFactorSchema).parse(row.factors),
        },
      })),
    },
    warnings,
  };
  // Cells are the core of the page: a malformed cell is an error, not something to hide.
  return { kind: 'ok', data: forecastApiResponseSchema.parse(response) };
}
