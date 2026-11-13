// Muted coastal vector palette, not satellite imagery. Local PMTiles only; no external service.
// Geographic labels are local DOM markers, so the map needs no remote glyphs or sprites.
import { layers, namedFlavor } from '@protomaps/basemaps';
import type { LayerSpecification } from 'maplibre-gl';

const LAND = '#293b34';
const LAND_SOFT = '#314139';
const WATER = '#203438';
const ROAD_MINOR = '#3b4b40';
const ROAD_MAJOR = '#4a5949';

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
    sand: '#4a4e3c',
    beach: '#505541',
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
    buildings: '#425044',
    railway: ROAD_MINOR,
    boundaries: '#637163',
  });
  if (dark.landcover) {
    flavor.landcover = Object.fromEntries(Object.keys(dark.landcover).map((key) => [key, LAND_SOFT]));
  }
  return layers('protomaps', flavor as unknown as typeof dark, { lang: 'ru' }).filter(
    (layer: LayerSpecification) => layer.type !== 'symbol',
  );
}
