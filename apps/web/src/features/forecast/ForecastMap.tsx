'use client';
// MapLibre map of the forecast cells. Created once; a new day only replaces the GeoJSON data.
// Basemap: local PMTiles extract (/tiles/agrakhan.pmtiles), Protomaps dark flavor without
// label layers, so the map makes no requests outside our server. Without the basemap file
// the cells are still drawn on a plain background.
import 'maplibre-gl/dist/maplibre-gl.css';

import { layers, namedFlavor } from '@protomaps/basemaps';
import {
  type GeoJSONSource,
  type LngLatBoundsLike,
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  addProtocol,
  setWorkerUrl,
} from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { CellDetails } from './CellDetails';
import styles from './forecast.module.css';
import type { CellCollection, CellFeature } from './schema';

const BASEMAP_PATH = '/tiles/agrakhan.pmtiles';
const CELLS_SOURCE = 'forecast-cells';
const FILL_LAYER = 'forecast-cells-fill';
const SELECTED_LAYER = 'forecast-cells-selected';

let mapLibreReady = false;
/** One-time global set-up: the worker file and the pmtiles:// protocol. */
function setupMapLibre(): void {
  if (mapLibreReady) return;
  // MapLibre 6 looks for its worker next to its own module, which does not exist in the
  // bundle; this reference makes the bundler emit the worker file and gives its URL.
  setWorkerUrl(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).href);
  addProtocol('pmtiles', new Protocol().tile);
  mapLibreReady = true;
}

/** Vertex average of the outer ring: good enough to anchor a popup on a hexagon. */
export function cellCenter(cell: CellFeature): [number, number] {
  const ring = cell.geometry.coordinates[0] ?? [];
  const points = ring.length > 1 ? ring.slice(0, -1) : ring;
  let lon = 0;
  let lat = 0;
  for (const point of points) {
    lon += point[0] ?? 0;
    lat += point[1] ?? 0;
  }
  return [lon / Math.max(points.length, 1), lat / Math.max(points.length, 1)];
}

function cellsBounds(cells: CellCollection): LngLatBoundsLike | null {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const feature of cells.features) {
    for (const [lon = 0, lat = 0] of feature.geometry.coordinates[0] ?? []) {
      minLon = Math.min(minLon, lon);
      minLat = Math.min(minLat, lat);
      maxLon = Math.max(maxLon, lon);
      maxLat = Math.max(maxLat, lat);
    }
  }
  return Number.isFinite(minLon) ? [minLon, minLat, maxLon, maxLat] : null;
}

type Props = {
  cells: CellCollection;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
};

export default function ForecastMap({ cells, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const cellsRef = useRef(cells);
  const onSelectRef = useRef(onSelect);
  const fittedRef = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [basemapMissing, setBasemapMissing] = useState(false);
  const [popupNode, setPopupNode] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // Create the map once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setupMapLibre();

    const basemap = layers('protomaps', namedFlavor('dark'), { lang: 'ru' }).filter(
      (layer) => layer.type !== 'symbol',
    );
    const map = new MapLibreMap({
      container,
      center: [47.65, 43.75],
      zoom: 8.3,
      attributionControl: { compact: true },
      style: {
        version: 8,
        sources: {
          protomaps: {
            type: 'vector',
            url: `pmtiles://${window.location.origin}${BASEMAP_PATH}`,
            attribution: '© участники OpenStreetMap (ODbL), Protomaps',
          },
          [CELLS_SOURCE]: {
            type: 'geojson',
            data: cellsRef.current,
            promoteId: 'id',
          },
        },
        layers: [
          ...basemap,
          {
            id: FILL_LAYER,
            type: 'fill',
            source: CELLS_SOURCE,
            paint: {
              // Same stops as PRESENCE_RAMP and the legend.
              'fill-color': [
                'interpolate',
                ['linear'],
                ['get', 'presence'],
                0,
                '#12263A',
                0.33,
                '#1FA39A',
                0.66,
                '#CDBB94',
                1,
                '#FF6A13',
              ],
              'fill-opacity': [
                'interpolate',
                ['linear'],
                ['get', 'presence'],
                0,
                0.12,
                0.33,
                0.55,
                0.66,
                0.7,
                1,
                0.78,
              ],
            },
          },
          {
            id: 'forecast-cells-outline',
            type: 'line',
            source: CELLS_SOURCE,
            paint: { 'line-color': '#E9EEF1', 'line-opacity': 0.12, 'line-width': 0.5 },
          },
          {
            id: SELECTED_LAYER,
            type: 'line',
            source: CELLS_SOURCE,
            filter: ['==', ['get', 'id'], -1],
            paint: { 'line-color': '#FF6A13', 'line-width': 3 },
          },
        ],
      },
    });
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');

    map.on('error', (event) => {
      const sourceId = (event as { sourceId?: string }).sourceId;
      const message = String((event as { error?: { message?: string } }).error?.message ?? '');
      if (sourceId === 'protomaps' || message.includes(BASEMAP_PATH) || message.includes('pmtiles')) {
        setBasemapMissing(true);
        return;
      }
      console.warn('[forecast map]', event.error);
    });
    map.on('load', () => {
      (map.getSource(CELLS_SOURCE) as GeoJSONSource | undefined)?.setData(cellsRef.current);
      setLoaded(true);
    });
    map.on('click', (event) => {
      const hit = map.queryRenderedFeatures(event.point, { layers: [FILL_LAYER] })[0];
      const id = hit?.properties?.id;
      onSelectRef.current(typeof id === 'number' ? id : null);
    });
    map.on('mouseenter', FILL_LAYER, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', FILL_LAYER, () => {
      map.getCanvas().style.cursor = '';
    });

    const node = document.createElement('div');
    const popup = new Popup({
      closeOnClick: false,
      maxWidth: '300px',
      offset: 8,
      className: styles.popup,
    }).setDOMContent(node);
    popup.on('close', () => onSelectRef.current(null));
    popupRef.current = popup;
    mapRef.current = map;
    setPopupNode(node);

    return () => {
      popup.remove();
      map.remove();
      mapRef.current = null;
      popupRef.current = null;
    };
  }, []);

  // New day or new run: replace the data of the existing source.
  useEffect(() => {
    cellsRef.current = cells;
    const map = mapRef.current;
    if (!map || !loaded) return;
    (map.getSource(CELLS_SOURCE) as GeoJSONSource | undefined)?.setData(cells);
    if (!fittedRef.current) {
      const bounds = cellsBounds(cells);
      if (bounds) {
        map.fitBounds(bounds, { padding: 32, duration: 0, maxZoom: 11 });
        fittedRef.current = true;
      }
    }
  }, [cells, loaded]);

  const selectedCell =
    selectedId === null ? null : (cells.features.find((feature) => feature.id === selectedId) ?? null);

  // Highlight and popup of the selected cell.
  useEffect(() => {
    const map = mapRef.current;
    const popup = popupRef.current;
    if (!map || !popup || !loaded) return;
    map.setFilter(SELECTED_LAYER, ['==', ['get', 'id'], selectedCell?.id ?? -1]);
    if (!selectedCell) {
      if (popup.isOpen()) popup.remove();
      return;
    }
    const center = cellCenter(selectedCell);
    popup.setLngLat(center);
    if (!popup.isOpen()) popup.addTo(map);
    if (!map.getBounds().contains(center)) map.easeTo({ center, duration: 300 });
  }, [selectedCell, loaded]);

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        data-testid="forecast-map"
        role="region"
        aria-label="Карта прогноза присутствия тюленя. Список ячеек с наибольшей вероятностью — в боковой панели."
        className="h-full w-full"
      />
      {basemapMissing ? (
        <p className="pointer-events-none absolute bottom-2 left-2 rounded bg-[var(--surface)]/90 px-2 py-1 text-xs text-[var(--muted)]">
          Подложка карты недоступна — показаны только ячейки прогноза
        </p>
      ) : null}
      {popupNode && selectedCell ? createPortal(<CellDetails cell={selectedCell} />, popupNode) : null}
    </div>
  );
}
