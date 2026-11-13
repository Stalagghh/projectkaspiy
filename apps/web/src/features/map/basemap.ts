// Night-watch colors for the offline Protomaps basemap, shared by the dashboard and forecast maps.
// Land recedes into near-black navy, water is a step lighter and bluer, roads are barely visible:
// the basemap is only a backdrop for zones, devices and alerts. Label layers are dropped, so the
// map needs no glyphs or sprites and makes no requests outside our server.
import { layers, namedFlavor } from '@protomaps/basemaps';
import type { LayerSpecification } from 'maplibre-gl';

const LAND = '#0b1520';
const LAND_SOFT = '#0d1a24';
const WATER = '#0c2638';
const ROAD_MINOR = '#16242f';
const ROAD_MAJOR = '#1d303f';

export const MAP_ATTRIBUTION = '© участники OpenStreetMap (ODbL), Protomaps';

export function basemapLayers(): LayerSpecification[] {
  const dark = namedFlavor('dark');
  const flavor: Record<string, unknown> = { ...dark };
  for (const key of Object.keys(dark)) {
    if (typeof flavor[key] !== 'string') continue;
    if (key.endsWith('_casing') || key.includes('casing_')) flavor[key] = LAND;
    else if (/^(tunnel_|bridges_)?(highway|major)$/.test(key)) flavor[key] = ROAD_MAJOR;
    else if (/^(tunnel_|bridges_)?(other|minor|minor_service|minor_a|minor_b|link)$/.test(key)) flavor[key] = ROAD_MINOR;
  }
  Object.assign(flavor, {
    background: LAND,
    earth: LAND,
    water: WATER,
    park_a: LAND_SOFT,
    park_b: LAND_SOFT,
    wood_a: LAND_SOFT,
    wood_b: LAND_SOFT,
    scrub_a: LAND_SOFT,
    scrub_b: LAND_SOFT,
    sand: '#101c26',
    beach: '#101c26',
    glacier: LAND,
    hospital: LAND,
    industrial: LAND,
    school: LAND,
    zoo: LAND,
    military: LAND,
    aerodrome: LAND,
    runway: ROAD_MINOR,
    pedestrian: LAND,
    pier: ROAD_MAJOR,
    buildings: '#101d29',
    railway: ROAD_MINOR,
    boundaries: '#2a4155',
  });
  if (dark.landcover) {
    flavor.landcover = Object.fromEntries(Object.keys(dark.landcover).map((key) => [key, LAND_SOFT]));
  }
  return layers('protomaps', flavor as unknown as typeof dark, { lang: 'ru' }).filter(
    (layer: LayerSpecification) => layer.type !== 'symbol',
  );
}
