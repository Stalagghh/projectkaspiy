// GeoJSON for the dashboard map. Server only.
import { getPool } from '@ecoshield/db';

import type { DeviceSensor, Feature, FeatureCollection, Geometry, MapGeo } from '../geo-types';

export type { MapGeo } from '../geo-types';

const collection = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features });

export async function loadMapGeo(): Promise<MapGeo> {
  const pool = getPool();
  const [areas, zones, haulouts, devices, bounds] = await Promise.all([
    pool.query<{ id: string; name_ru: string; attribution: string; boundary: Geometry; ops: Geometry }>(
      `SELECT id, name_ru, attribution,
              ST_AsGeoJSON(boundary, 6)::json AS boundary, ST_AsGeoJSON(ops_area, 6)::json AS ops
         FROM areas ORDER BY id`,
    ),
    pool.query<{ id: string; area_id: string; kind: string; name_ru: string; is_illustrative: boolean; geom: Geometry }>(
      `SELECT id, area_id, kind, name_ru, is_illustrative, ST_AsGeoJSON(geom, 6)::json AS geom
         FROM zones ORDER BY id`,
    ),
    pool.query<{ id: string; name_ru: string; is_candidate: boolean; geom: Geometry }>(
      `SELECT id, name_ru, is_candidate, ST_AsGeoJSON(location, 6)::json AS geom FROM haulouts ORDER BY id`,
    ),
    pool.query<{
      id: string;
      kind: string;
      name_ru: string;
      is_simulated: boolean;
      last_seen_at: Date | null;
      geom: Geometry;
      sensors: DeviceSensor[];
    }>(
      `SELECT d.id, d.kind, d.name_ru, d.is_simulated, d.last_seen_at,
              ST_AsGeoJSON(d.location, 6)::json AS geom,
              COALESCE(
                json_agg(json_build_object(
                  'sensorId', s.id, 'metric', s.metric, 'unit', s.unit,
                  'value', lr.value, 'ts', lr.ts, 'quality', lr.quality) ORDER BY s.metric)
                  FILTER (WHERE s.id IS NOT NULL),
                '[]'::json) AS sensors
         FROM devices d
         LEFT JOIN sensors s ON s.device_id = d.id
         LEFT JOIN LATERAL (
           SELECT r.value, r.ts, r.quality FROM readings r
            WHERE r.sensor_id = s.id ORDER BY r.ts DESC LIMIT 1
         ) lr ON true
        GROUP BY d.id
        ORDER BY d.id`,
    ),
    pool.query<{ west: number | null; south: number | null; east: number | null; north: number | null }>(
      `SELECT ST_XMin(e) AS west, ST_YMin(e) AS south, ST_XMax(e) AS east, ST_YMax(e) AS north
         FROM (SELECT ST_Extent(ops_area) AS e FROM areas) x`,
    ),
  ]);

  const b = bounds.rows[0];
  return {
    area: collection(
      areas.rows.map((r) => ({
        type: 'Feature',
        id: r.id,
        geometry: r.boundary,
        properties: { id: r.id, name: r.name_ru, attribution: r.attribution },
      })),
    ),
    opsArea: collection(
      areas.rows.map((r) => ({ type: 'Feature', id: `${r.id}-ops`, geometry: r.ops, properties: { id: r.id } })),
    ),
    zones: collection(
      zones.rows.map((r) => ({
        type: 'Feature',
        id: r.id,
        geometry: r.geom,
        properties: { id: r.id, kind: r.kind, name: r.name_ru, isIllustrative: r.is_illustrative },
      })),
    ),
    haulouts: collection(
      haulouts.rows.map((r) => ({
        type: 'Feature',
        id: r.id,
        geometry: r.geom,
        properties: { id: r.id, name: r.name_ru, isCandidate: r.is_candidate },
      })),
    ),
    devices: collection(
      devices.rows.map((r) => ({
        type: 'Feature',
        id: r.id,
        geometry: r.geom,
        properties: {
          id: r.id,
          kind: r.kind,
          name: r.name_ru,
          isSimulated: r.is_simulated,
          lastSeenAt: r.last_seen_at ? r.last_seen_at.toISOString() : null,
          sensors: r.sensors,
        },
      })),
    ),
    opsBounds:
      b && b.west !== null && b.south !== null && b.east !== null && b.north !== null
        ? [b.west, b.south, b.east, b.north]
        : null,
  };
}
