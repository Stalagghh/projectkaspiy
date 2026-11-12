// Seal presence forecast job: gathers 7 days of area-average hydrology (real sources when reachable),
// asks the ML service for the forecast and stores the run. Runs shortly after startup, then every 6 h.
import { forecastRequestSchema, type ForecastRequest } from '@ecoshield/contracts';
import { getPool } from '@ecoshield/db';

import { forecastSeal, type MlConfig } from './ml.ts';
import { withTransaction } from './pipeline.ts';

const AREA_ID = 'agrakhan';
const DAYS = 7;
const EVERY_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

const WIND_URL =
  'https://api.open-meteo.com/v1/forecast?latitude=43.95&longitude=47.75&hourly=wind_speed_10m&wind_speed_unit=ms&forecast_days=7&timezone=Europe%2FMoscow';
const WAVES_URL =
  'https://marine-api.open-meteo.com/v1/marine?latitude=43.95&longitude=47.75&hourly=wave_height&forecast_days=7&timezone=Europe%2FMoscow';
const SST_URL =
  'https://coastwatch.pfeg.noaa.gov/erddap/griddap/ncdcOisst21Agg_LonPM180.json?sst%5B(last)%5D%5B(0.0)%5D%5B(44.125)%5D%5B(47.875)%5D';

/** Documented fallback values when no real data and no earlier run exist (marked "synthetic" in the UI). */
const SYNTHETIC = { windSpeedMs: 6, waveHeightM: 0.6, sstC: 12 } as const;
const SYNTHETIC_NAME = 'синтетика по допущениям';

type Hydrology = ForecastRequest['hydrology'];
type Source = Hydrology[number]['sources']['wind'];
type Series = { values: number[]; source: Source };

/** Today's date in Moscow time as YYYY-MM-DD, then the following days. */
export function forecastDates(now: Date, days: number): string[] {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(now);
  const start = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10));
}

/** Daily means of an hourly series whose timestamps are local "YYYY-MM-DDTHH:MM" strings. */
export function dailyMeans(times: string[], values: (number | null)[], dates: string[]): number[] {
  return dates.map((date) => {
    const day = values.filter((v, i): v is number => typeof v === 'number' && times[i]?.startsWith(date) === true);
    if (day.length === 0) throw new Error(`no hourly values for ${date}`);
    return day.reduce((a, b) => a + b, 0) / day.length;
  });
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

async function fetchOpenMeteo(url: string, variable: string, dates: string[]): Promise<Series> {
  const body = (await getJson(url)) as { hourly?: Record<string, unknown> };
  const times = body.hourly?.time;
  const values = body.hourly?.[variable];
  if (!Array.isArray(times) || !Array.isArray(values)) throw new Error(`unexpected Open-Meteo response for ${variable}`);
  return {
    values: dailyMeans(times as string[], values as (number | null)[], dates),
    source: { name: 'Open-Meteo', kind: 'real', asOf: new Date().toISOString() },
  };
}

async function fetchSst(dates: string[]): Promise<Series> {
  const body = (await getJson(SST_URL)) as { table?: { rows?: unknown[][] } };
  const row = body.table?.rows?.[0];
  const time = row?.[0];
  const sst = row?.[4];
  if (typeof time !== 'string' || typeof sst !== 'number') throw new Error('unexpected OISST response');
  // Persistence (assumption A-S6): the latest daily SST is used for all forecast days.
  return { values: dates.map(() => sst), source: { name: 'NOAA OISST v2.1', kind: 'real', asOf: time } };
}

type Variable = 'wind' | 'waves' | 'sst';
const FIELD = { wind: 'windSpeedMs', waves: 'waveHeightM', sst: 'sstC' } as const;

/** Fallback for one variable: the latest stored run (its values, sources and asOf), else synthetic values. */
function fallback(variable: Variable, previous: Hydrology | null, dates: string[]): Series {
  const field = FIELD[variable];
  if (previous && previous.length > 0) {
    const last = previous[previous.length - 1] as Hydrology[number];
    return {
      values: dates.map((_, i) => (previous[i] ?? last)[field]),
      source: (previous[0] as Hydrology[number]).sources[variable],
    };
  }
  return {
    values: dates.map(() => SYNTHETIC[field]),
    source: { name: SYNTHETIC_NAME, kind: 'synthetic', asOf: new Date().toISOString() },
  };
}

async function latestHydrology(): Promise<Hydrology | null> {
  const rows = await getPool().query<{ hydrology: unknown }>(
    'SELECT hydrology FROM forecast_runs WHERE area_id = $1 ORDER BY issued_at DESC LIMIT 1',
    [AREA_ID],
  );
  const parsed = forecastRequestSchema.shape.hydrology.safeParse(rows.rows[0]?.hydrology);
  return parsed.success ? parsed.data : null;
}

export async function buildHydrology(dates: string[]): Promise<Hydrology> {
  const attempts: Record<Variable, Promise<Series>> = {
    wind: fetchOpenMeteo(WIND_URL, 'wind_speed_10m', dates),
    waves: fetchOpenMeteo(WAVES_URL, 'wave_height', dates),
    sst: fetchSst(dates),
  };
  const series = {} as Record<Variable, Series>;
  let previous: Hydrology | null | undefined;
  for (const variable of ['wind', 'waves', 'sst'] as const) {
    try {
      series[variable] = await attempts[variable];
    } catch (error) {
      previous ??= await latestHydrology();
      series[variable] = fallback(variable, previous, dates);
      console.warn(
        `ingest: forecast ${variable} source failed (${(error as Error).message}); using ${series[variable].source.name}`,
      );
    }
  }
  return dates.map((date, i) => ({
    date,
    windSpeedMs: Math.max(0, Number((series.wind.values[i] ?? 0).toFixed(2))),
    waveHeightM: Math.max(0, Number((series.waves.values[i] ?? 0).toFixed(2))),
    sstC: Number((series.sst.values[i] ?? 0).toFixed(2)),
    sources: { wind: series.wind.source, waves: series.waves.source, sst: series.sst.source },
  }));
}

type CellRow = { id: number; lat: number; lon: number; dist_haulout_km: number; dist_coast_km: number };

/** Returns false when there was nothing to forecast yet (no cells), so the job retries sooner. */
export async function runForecast(ml: MlConfig): Promise<boolean> {
  const cells = await getPool().query<CellRow>(
    `SELECT id, ST_Y(centroid) AS lat, ST_X(centroid) AS lon, dist_haulout_km, dist_coast_km
       FROM forecast_cells WHERE area_id = $1 ORDER BY id`,
    [AREA_ID],
  );
  if (cells.rows.length === 0) {
    console.log('ingest: forecast skipped: no forecast_cells for area agrakhan (seed not loaded)');
    return false;
  }
  const now = new Date();
  const dates = forecastDates(now, DAYS);
  const request = forecastRequestSchema.parse({
    areaId: AREA_ID,
    issuedAt: now.toISOString(),
    startDate: dates[0],
    days: DAYS,
    cells: cells.rows.map((c) => ({
      id: c.id,
      lat: c.lat,
      lon: c.lon,
      distHauloutKm: c.dist_haulout_km,
      distCoastKm: c.dist_coast_km,
    })),
    hydrology: await buildHydrology(dates),
  });
  const response = await forecastSeal(ml, request);

  const days: string[] = [];
  const cellIds: number[] = [];
  const presence: number[] = [];
  const levels: string[] = [];
  const factors: string[] = [];
  for (const day of response.days) {
    for (const cell of day.cells) {
      days.push(day.date);
      cellIds.push(cell.id);
      presence.push(cell.presence);
      levels.push(cell.level);
      factors.push(JSON.stringify(cell.factors));
    }
  }
  const runId = await withTransaction(async (db) => {
    const run = await db.query<{ id: string }>(
      `INSERT INTO forecast_runs (area_id, issued_at, start_date, days, model_name, model_version, hydrology,
                                  summaries, assumptions)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb) RETURNING id`,
      [
        AREA_ID,
        request.issuedAt,
        request.startDate,
        request.days,
        response.model.name,
        response.model.version,
        JSON.stringify(request.hydrology),
        JSON.stringify(response.days.map((d) => ({ date: d.date, summaryRu: d.summaryRu, summaryEn: d.summaryEn }))),
        JSON.stringify(response.assumptions),
      ],
    );
    const id = run.rows[0]?.id as string;
    // One statement for all values: parallel arrays expanded by unnest (fully parameterized).
    await db.query(
      `INSERT INTO forecast_values (run_id, day, cell_id, presence, level, factors)
       SELECT $1, t.day, t.cell_id, t.presence, t.level, t.factors::jsonb
         FROM unnest($2::date[], $3::int[], $4::real[], $5::text[], $6::text[])
              AS t(day, cell_id, presence, level, factors)`,
      [id, days, cellIds, presence, levels, factors],
    );
    return id;
  });
  console.log(`ingest: forecast run ${runId} stored (${days.length} values, model ${response.model.version})`);
  return true;
}

/** Retry delay after a failed or skipped run (ML still loading, seed not loaded yet). */
const RETRY_MS = 60_000;

export function startForecastJob(ml: MlConfig, firstDelayMs: number): { stop(): void } {
  let running = false;
  let retry: NodeJS.Timeout | undefined;
  const run = (): void => {
    if (running) return;
    running = true;
    clearTimeout(retry);
    runForecast(ml)
      .catch((error: unknown) => {
        console.error(`ingest: forecast job failed: ${(error as Error).message}`);
        return false;
      })
      .then((ok) => {
        if (!ok) retry = setTimeout(run, RETRY_MS);
      })
      .finally(() => {
        running = false;
      });
  };
  const first = setTimeout(run, firstDelayMs);
  const every = setInterval(run, EVERY_MS);
  return {
    stop() {
      clearTimeout(first);
      clearTimeout(retry);
      clearInterval(every);
    },
  };
}
