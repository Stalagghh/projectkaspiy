'use client';
// MapLibre map of the forecast cells. Created once; a new day only replaces the GeoJSON data.
// Basemap: local PMTiles extract (/tiles/agrakhan.pmtiles), Protomaps dark flavor without
// label layers, so the map makes no requests outside our server. Without the basemap file
// the cells are still drawn on a plain background.
import 'maplibre-gl/dist/maplibre-gl.css';

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

import { basemapLayers, MAP_ATTRIBUTION } from '@/features/map/basemap';

import { CellDetails } from './CellDetails';
import styles from './forecast.module.css';
import { PRESENCE_RAMP, type CellCollection, type CellFeature } from './schema';

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

    const basemap = basemapLayers();
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
            attribution: MAP_ATTRIBUTION,
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
                PRESENCE_RAMP[0].color,
                0.33,
                PRESENCE_RAMP[1].color,
                0.66,
                PRESENCE_RAMP[2].color,
                1,
                PRESENCE_RAMP[3].color,
              ],
              'fill-opacity': [
                'interpolate',
                ['linear'],
                ['get', 'presence'],
                0,
                PRESENCE_RAMP[0].opacity,
                0.33,
                PRESENCE_RAMP[1].opacity,
                0.66,
                PRESENCE_RAMP[2].opacity,
                1,
                PRESENCE_RAMP[3].opacity,
              ],
            },
          },
          {
            id: 'forecast-cells-outline',
            type: 'line',
            source: CELLS_SOURCE,
            paint: { 'line-color': '#233b32', 'line-opacity': 0.4, 'line-width': 1 },
          },
          {
            id: SELECTED_LAYER,
            type: 'line',
            source: CELLS_SOURCE,
            filter: ['==', ['get', 'id'], -1],
            paint: { 'line-color': '#e6f4d9', 'line-width': 3 },
          },
        ],
      },
    });
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    const resize = new ResizeObserver(() => map.resize());
    resize.observe(container);

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
      anchor: 'bottom',
      maxWidth: '300px',
      offset: 8,
      className: styles.popup,
    }).setDOMContent(node);
    popup.on('close', () => onSelectRef.current(null));
    popupRef.current = popup;
    mapRef.current = map;
    setPopupNode(node);

    return () => {
      resize.disconnect();
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
    // Keep the full explanation within a short map, above its selected cell and controls.
    map.easeTo({ center, offset: [0, Math.min(110, map.getContainer().clientHeight * 0.27)], duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250 });
  }, [selectedCell, loaded]);

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        data-testid="forecast-map"
        role="region"
        aria-label="Карта модельного индекса присутствия тюленя. Список ячеек с наибольшим индексом — в панели пояснений."
        className="h-full w-full"
      />
      {basemapMissing ? (
        <p className="map-message map-panel">Подложка карты недоступна — показаны только ячейки прогноза</p>
      ) : null}
      {popupNode && selectedCell ? createPortal(<CellDetails cell={selectedCell} />, popupNode) : null}
    </div>
  );
}
