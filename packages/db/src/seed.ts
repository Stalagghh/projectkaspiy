// Loads the demo geography (GeoJSON files in packages/db/seed) into the database.
// Idempotent: one transaction of upserts, safe to run again after the files change.
// Run: DATABASE_URL=... node packages/db/src/seed.ts   (SEED_DIR overrides the directory)
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { METRICS, type MetricName } from '@ecoshield/contracts';

import { closePool, getPool } from './client.ts';

const AREA_ID = 'agrakhan';
const DEFAULT_SEED_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'seed');

// Expected property types per file. "string?" means optional or null. (zod is not a dependency of
// this package, so the few checks we need are written out by hand.)
type PropType = 'string' | 'string?' | 'number' | 'boolean' | 'kind';
type Spec = { file: string; geometry: readonly string[]; props: Record<string, PropType>; kinds?: readonly string[] };

const FILES = {
  boundary: { file: 'agrakhan-boundary.geojson', geometry: ['MultiPolygon', 'Polygon'], props: { id: 'string', name_ru: 'string', name_en: 'string', source: 'string', attribution: 'string' } },
  opsArea: { file: 'ops-area.geojson', geometry: ['MultiPolygon', 'Polygon'], props: {} },
  zones: { file: 'zones.geojson', geometry: ['Polygon'], props: { id: 'string', kind: 'kind', name_ru: 'string', name_en: 'string', illustrative: 'boolean' }, kinds: ['no_entry', 'buffer'] },
  haulouts: { file: 'haulouts.geojson', geometry: ['Point'], props: { id: 'string', name_ru: 'string', name_en: 'string', osm_ref: 'string?', candidate: 'boolean' } },
  devices: { file: 'devices.geojson', geometry: ['Point'], props: { id: 'string', kind: 'kind', name_ru: 'string', simulated: 'boolean' }, kinds: ['acoustic_buoy', 'water_station'] },
  cells: { file: 'forecast-cells.geojson', geometry: ['Polygon'], props: { id: 'number', dist_haulout_km: 'number', dist_coast_km: 'number' } },
} satisfies Record<string, Spec>;

export type Feature = { geometry: { type: string; coordinates: unknown[] }; properties: Record<string, unknown> };

/** Checks a parsed GeoJSON FeatureCollection against a spec; throws a readable error on the first problem. */
export function checkCollection(json: unknown, spec: Spec): Feature[] {
  const fail = (where: string, what: string): never => {
    throw new Error(`seed file ${spec.file} is invalid at ${where}: ${what}`);
  };
  const fc = json as { type?: unknown; features?: unknown };
  if (fc?.type !== 'FeatureCollection' || !Array.isArray(fc.features)) fail('root', 'expected a FeatureCollection');
  const features = fc.features as Feature[];
  features.forEach((f, i) => {
    const g = f?.geometry;
    if (!g || !spec.geometry.includes(g.type) || !Array.isArray(g.coordinates)) {
      fail(`features[${i}].geometry`, `expected ${spec.geometry.join(' or ')}`);
    }
    const props = f.properties ?? {};
    for (const [name, type] of Object.entries(spec.props)) {
      const value = props[name];
      const ok =
        type === 'string?' ? value === undefined || value === null || typeof value === 'string'
        : type === 'kind' ? typeof value === 'string' && (spec.kinds ?? []).includes(value)
        : type === 'number' ? typeof value === 'number' && Number.isFinite(value)
        : typeof value === type;
      if (!ok) fail(`features[${i}].properties.${name}`, `expected ${type === 'kind' ? (spec.kinds ?? []).join('|') : type}`);
    }
  });
  return features;
}

async function load(dir: string, spec: Spec): Promise<Feature[]> {
  const path = join(dir, spec.file);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    throw new Error(`seed file missing: ${path}`);
  }
  return checkCollection(JSON.parse(text), spec);
}

const GEOM = 'ST_SetSRID(ST_GeomFromGeoJSON($GEOM), 4326)';
const geom = (param: string): string => GEOM.replace('$GEOM', param);

export type SeedCounts = Record<'areas' | 'zones' | 'haulouts' | 'devices' | 'sensors' | 'forecastCells', number>;

export async function seed(dir: string = process.env.SEED_DIR ?? DEFAULT_SEED_DIR): Promise<SeedCounts> {
  // Read and validate every file before touching the database.
  const boundary = await load(dir, FILES.boundary);
  const opsArea = await load(dir, FILES.opsArea);
  const zones = await load(dir, FILES.zones);
  const haulouts = await load(dir, FILES.haulouts);
  const devices = await load(dir, FILES.devices);
  const cells = await load(dir, FILES.cells);

  const area = boundary[0];
  const ops = opsArea[0];
  if (boundary.length !== 1 || !area) throw new Error(`${FILES.boundary.file} must contain exactly 1 feature`);
  if (opsArea.length !== 1 || !ops) throw new Error(`${FILES.opsArea.file} must contain exactly 1 feature`);
  if (area.properties.id !== AREA_ID) throw new Error(`${FILES.boundary.file}: area id must be "${AREA_ID}"`);

  const counts: SeedCounts = { areas: 0, zones: 0, haulouts: 0, devices: 0, sensors: 0, forecastCells: 0 };
  const db = await getPool().connect();
  try {
    await db.query('BEGIN');
    await db.query(
      `INSERT INTO areas (id, name_ru, name_en, boundary, boundary_source, ops_area, attribution)
       VALUES ($1, $2, $3, ST_Multi(${geom('$4')}), $5, ST_Multi(${geom('$6')}), $7)
       ON CONFLICT (id) DO UPDATE SET name_ru = EXCLUDED.name_ru, name_en = EXCLUDED.name_en,
         boundary = EXCLUDED.boundary, boundary_source = EXCLUDED.boundary_source,
         ops_area = EXCLUDED.ops_area, attribution = EXCLUDED.attribution`,
      [
        AREA_ID,
        area.properties.name_ru,
        area.properties.name_en,
        JSON.stringify(area.geometry),
        area.properties.source,
        JSON.stringify(ops.geometry),
        area.properties.attribution,
      ],
    );
    counts.areas = 1;

    for (const f of zones) {
      await db.query(
        `INSERT INTO zones (id, area_id, kind, name_ru, name_en, geom, is_illustrative)
         VALUES ($1, $2, $3, $4, $5, ${geom('$6')}, $7)
         ON CONFLICT (id) DO UPDATE SET area_id = EXCLUDED.area_id, kind = EXCLUDED.kind,
           name_ru = EXCLUDED.name_ru, name_en = EXCLUDED.name_en, geom = EXCLUDED.geom,
           is_illustrative = EXCLUDED.is_illustrative`,
        [f.properties.id, AREA_ID, f.properties.kind, f.properties.name_ru, f.properties.name_en, JSON.stringify(f.geometry), f.properties.illustrative],
      );
      counts.zones++;
    }

    for (const f of haulouts) {
      await db.query(
        `INSERT INTO haulouts (id, area_id, name_ru, name_en, location, osm_ref, is_candidate)
         VALUES ($1, $2, $3, $4, ${geom('$5')}, $6, $7)
         ON CONFLICT (id) DO UPDATE SET area_id = EXCLUDED.area_id, name_ru = EXCLUDED.name_ru,
           name_en = EXCLUDED.name_en, location = EXCLUDED.location, osm_ref = EXCLUDED.osm_ref,
           is_candidate = EXCLUDED.is_candidate`,
        [f.properties.id, AREA_ID, f.properties.name_ru, f.properties.name_en, JSON.stringify(f.geometry), f.properties.osm_ref ?? null, f.properties.candidate],
      );
      counts.haulouts++;
    }

    for (const f of devices) {
      // boot_id, last_seq and last_seen_at belong to the live system and are never overwritten here.
      await db.query(
        `INSERT INTO devices (id, area_id, kind, name_ru, location, is_simulated)
         VALUES ($1, $2, $3, $4, ${geom('$5')}, $6)
         ON CONFLICT (id) DO UPDATE SET area_id = EXCLUDED.area_id, kind = EXCLUDED.kind,
           name_ru = EXCLUDED.name_ru, location = EXCLUDED.location, is_simulated = EXCLUDED.is_simulated`,
        [f.properties.id, AREA_ID, f.properties.kind, f.properties.name_ru, JSON.stringify(f.geometry), f.properties.simulated],
      );
      counts.devices++;
      if (f.properties.kind !== 'water_station') continue;
      for (const metric of Object.keys(METRICS) as MetricName[]) {
        await db.query(
          `INSERT INTO sensors (id, device_id, metric, unit) VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE SET device_id = EXCLUDED.device_id, metric = EXCLUDED.metric, unit = EXCLUDED.unit`,
          [`${f.properties.id}.${metric}`, f.properties.id, metric, METRICS[metric].unit],
        );
        counts.sensors++;
      }
    }

    for (const f of cells) {
      await db.query(
        `INSERT INTO forecast_cells (id, area_id, geom, centroid, dist_haulout_km, dist_coast_km)
         VALUES ($1, $2, ${geom('$3')}, ST_Centroid(${geom('$3')}), $4, $5)
         ON CONFLICT (id) DO UPDATE SET area_id = EXCLUDED.area_id, geom = EXCLUDED.geom,
           centroid = EXCLUDED.centroid, dist_haulout_km = EXCLUDED.dist_haulout_km,
           dist_coast_km = EXCLUDED.dist_coast_km`,
        [f.properties.id, AREA_ID, JSON.stringify(f.geometry), f.properties.dist_haulout_km, f.properties.dist_coast_km],
      );
      counts.forecastCells++;
    }
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    db.release();
  }
  return counts;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seed()
    .then((c) =>
      console.log(
        `seed: areas ${c.areas}, zones ${c.zones}, haulouts ${c.haulouts}, devices ${c.devices}, sensors ${c.sensors}, forecast cells ${c.forecastCells}`,
      ),
    )
    .catch((error: unknown) => {
      console.error(`seed: ${(error as Error).message}`);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
