'use client';
// MapLibre GL 6 map with the offline Protomaps basemap (PMTiles served by our own route).
// The map instance lives in a ref and is created once; live updates only touch marker DOM.
import 'maplibre-gl/dist/maplibre-gl.css';

import { ChevronDown, Droplets, FlaskConical, Layers, Radio } from 'lucide-react';
import {
  addProtocol,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type GeoJSONSourceSpecification,
  type StyleSpecification,
} from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { AlertDto, Severity } from '@ecoshield/contracts';

import { SEVERITY_ICON } from '@/features/dashboard/SeverityBadge';
import { basemapLayers, MAP_ATTRIBUTION } from '@/features/map/basemap';
import type { MapDevice, MapGeo } from '@/features/map/geo-types';
import { AUDIO_LABEL, formatPercent, formatTime, KIND_LABEL, SEVERITY_LABEL, STATUS_LABEL } from '@/lib/labels';
import { useMediaQuery } from '@/lib/useMediaQuery';

const FALLBACK_CENTER: [number, number] = [47.45, 43.65];
/** Open sea east of the Agrakhan peninsula: where the name of the sea is written. */
const SEA_LABEL_AT: [number, number] = [48.02, 43.72];
/** Alerts at the same buoy overlap: the most severe (and the selected one) stays on top. */
const SEVERITY_Z: Record<Severity, number> = { info: 1, warning: 2, critical: 3 };
/** Unresolved alerts at one buoy fan out by this many pixels so that each stays clickable. */
const STACK_STEP_PX = 22;
/** Further alerts at the same place sit under the last fanned-out one. */
const STACK_MAX = 3;
/** Width of the alert card plus its margin (see .detail-overlay in globals.css). */
const CARD_WIDTH_PX = 464;

let protocolRegistered = false;
function registerPmtiles(): void {
  if (protocolRegistered) return;
  const protocol = new Protocol();
  addProtocol('pmtiles', protocol.tile);
  setWorkerUrl(`${window.location.origin}/vendor/maplibre-worker`);
  protocolRegistered = true;
}

function buildStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://${window.location.origin}/tiles/agrakhan.pmtiles`,
        attribution: MAP_ATTRIBUTION,
      },
    },
    layers: basemapLayers(),
  };
}

type AlertMarker = { marker: Marker; el: HTMLButtonElement; root: Root; signature: string };
type Overlay = { roots: Root[]; markers: Marker[] };

type Props = {
  alerts: AlertDto[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Called once with the devices of the area, for panels outside the map. */
  onDevices?: (devices: MapDevice[]) => void;
  /** The alert card covers the right side of the map on wide screens. */
  detailOpen?: boolean;
};

const isOpenAlert = (alert: AlertDto): boolean => alert.status !== 'resolved' && alert.status !== 'false_positive';

function alertLabel(alert: AlertDto): string {
  return `${SEVERITY_LABEL[alert.severity]}: ${KIND_LABEL[alert.kind]}, ${alert.deviceName ?? 'устройство не указано'}, ${formatTime(
    alert.eventAt,
  )}, ${STATUS_LABEL[alert.status]}`;
}

function textMarker(text: string, className: string): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  el.setAttribute('aria-hidden', 'true');
  return el;
}

function formatCursor(lat: number, lon: number): string {
  return `${lat.toFixed(4)}° с. ш.  ${lon.toFixed(4)}° в. д.`;
}

export default function MapView({ alerts, selectedId, onSelect, onDevices, detailOpen = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const coordsRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const alertMarkers = useRef(new Map<string, AlertMarker>());
  const onSelectRef = useRef(onSelect);
  const onDevicesRef = useRef(onDevices);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The legend starts open where there is room for it; the user's choice wins afterwards.
  const wide = useMediaQuery('(min-width: 900px)', true);
  const [legendChoice, setLegendChoice] = useState<boolean | null>(null);
  const legendOpen = legendChoice ?? wide;

  useEffect(() => {
    onSelectRef.current = onSelect;
    onDevicesRef.current = onDevices;
  }, [onSelect, onDevices]);

  // Create the map once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    registerPmtiles();
    const map = new MapLibreMap({
      container,
      style: buildStyle(),
      center: FALLBACK_CENTER,
      zoom: 9,
      attributionControl: { compact: false },
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
    map.addControl(new ScaleControl({ unit: 'metric', maxWidth: 110 }), 'bottom-right');

    const showCoords = (lat: number, lon: number) => {
      if (coordsRef.current) coordsRef.current.textContent = formatCursor(lat, lon);
    };
    map.on('mousemove', (event) => showCoords(event.lngLat.lat, event.lngLat.lng));
    map.on('moveend', () => {
      const center = map.getCenter();
      showCoords(center.lat, center.lng);
    });

    const overlay: Overlay = { roots: [], markers: [] };
    let disposed = false;
    const geoPromise = fetch('/api/map/geo', { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as MapGeo;
    });

    map.on('load', () => {
      geoPromise
        .then((geo) => {
          if (disposed) return;
          addOverlays(map, geo);

          overlay.markers.push(
            new Marker({ element: textMarker('Каспийское море', 'geo-label geo-label-sea') }).setLngLat(SEA_LABEL_AT).addTo(map),
          );
          for (const feature of geo.haulouts.features) {
            const name = String(feature.properties.name ?? '');
            if (!name) continue;
            overlay.markers.push(
              new Marker({ element: textMarker(name, 'geo-label'), anchor: 'bottom', offset: [0, -8] })
                .setLngLat(feature.geometry.coordinates as [number, number])
                .addTo(map),
            );
          }

          const devices = geo.devices.features.map((feature) => feature.properties as MapDevice);
          geo.devices.features.forEach((feature, index) => {
            const device = devices[index]!;
            const isStation = device.kind === 'water_station';
            const el = document.createElement('div');
            el.className = 'dev-marker';
            el.dataset.kind = device.kind;
            el.dataset.deviceId = device.id;
            el.setAttribute('role', 'img');
            el.setAttribute('aria-label', `${isStation ? 'Станция качества воды' : 'Акустический буй'}: ${device.name}`);
            const glyph = document.createElement('span');
            glyph.className = 'dev-glyph';
            el.append(glyph);
            const root = createRoot(glyph);
            const Icon = isStation ? Droplets : Radio;
            root.render(<Icon size={14} aria-hidden={true} />);
            overlay.roots.push(root);
            const nameEl = document.createElement('span');
            // "Акустический буй 02" -> "Буй 02": the glyph already tells the kind.
            nameEl.textContent = device.name.replace('Акустический буй', 'Буй').replace('Станция воды', 'Ст.');
            el.append(nameEl);
            overlay.markers.push(
              new Marker({ element: el, anchor: 'left', offset: [-13, 0] })
                .setLngLat(feature.geometry.coordinates as [number, number])
                .addTo(map),
            );
          });
          onDevicesRef.current?.(devices);

          if (geo.opsBounds) {
            const [west, south, east, north] = geo.opsBounds;
            map.fitBounds(
              [
                [west, south],
                [east, north],
              ],
              { padding: 48, duration: 0 },
            );
          }
          setReady(true);
        })
        .catch(() => {
          if (!disposed) setError('Слои карты не загрузились (зоны, устройства). Обновите страницу.');
        });
    });
    map.on('error', (event) => {
      console.warn('[map]', event.error?.message);
    });

    const markers = alertMarkers.current;
    return () => {
      disposed = true;
      for (const marker of overlay.markers) marker.remove();
      for (const { marker, root } of markers.values()) {
        marker.remove();
        root.unmount();
      }
      markers.clear();
      const roots = [...overlay.roots];
      // Unmount marker roots after the current render pass.
      queueMicrotask(() => roots.forEach((root) => root.unmount()));
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Alert markers: add, update and remove without touching the map instance.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const seen = new Set<string>();
    // `alerts` is sorted by severity and priority, so the first open alert at a place is its top one.
    const openAtPlace = new Map<string, number>();
    for (const alert of alerts) {
      if (!alert.location) continue;
      seen.add(alert.id);
      const place = `${alert.location.lat.toFixed(5)},${alert.location.lon.toFixed(5)}`;
      const stackIndex = isOpenAlert(alert) ? (openAtPlace.get(place) ?? 0) : 0;
      if (isOpenAlert(alert)) openAtPlace.set(place, stackIndex + 1);

      let entry = alertMarkers.current.get(alert.id);
      if (!entry) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'alert-marker';
        el.addEventListener('click', (event) => {
          event.stopPropagation();
          onSelectRef.current(alert.id);
        });
        entry = {
          el,
          root: createRoot(el),
          signature: '',
          marker: new Marker({ element: el }).setLngLat([alert.location.lon, alert.location.lat]).addTo(map),
        };
        alertMarkers.current.set(alert.id, entry);
      }
      const selected = alert.id === selectedId;
      entry.el.dataset.severity = alert.severity;
      entry.el.dataset.status = alert.status;
      entry.el.dataset.alertId = alert.id;
      entry.el.setAttribute('aria-label', alertLabel(alert));
      entry.el.classList.toggle('is-selected', selected);
      entry.el.classList.toggle('is-top', isOpenAlert(alert) && stackIndex === 0);
      entry.marker.getElement().style.zIndex = String(
        (isOpenAlert(alert) ? 20 : 10) + SEVERITY_Z[alert.severity] - stackIndex + (selected ? 20 : 0),
      );
      entry.marker.setLngLat([alert.location.lon, alert.location.lat]);
      const shift = Math.min(stackIndex, STACK_MAX) * STACK_STEP_PX;
      entry.marker.setOffset([-shift, shift]);

      const title = alert.detection ? (AUDIO_LABEL[alert.detection.label] ?? KIND_LABEL[alert.kind]) : KIND_LABEL[alert.kind];
      const confidence = alert.detection ? formatPercent(alert.detection.confidence) : '';
      const signature = `${alert.severity}|${title}|${confidence}`;
      if (entry.signature !== signature) {
        const Icon = SEVERITY_ICON[alert.severity];
        entry.root.render(
          <>
            <span className="alert-marker-core">
              <Icon size={18} aria-hidden={true} />
            </span>
            <span className="alert-marker-label" aria-hidden="true">
              {title}
              {confidence && <span className="num">{confidence}</span>}
            </span>
          </>,
        );
        entry.signature = signature;
      }
    }
    for (const [id, entry] of alertMarkers.current) {
      if (seen.has(id)) continue;
      entry.marker.remove();
      const root = entry.root;
      queueMicrotask(() => root.unmount());
      alertMarkers.current.delete(id);
    }
  }, [alerts, selectedId, ready]);

  // Bring the selected alert into view, in the part of the map that the alert card leaves free.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const padding = { top: 0, bottom: 0, left: 0, right: detailOpen && wide ? CARD_WIDTH_PX : 0 };
    const alert = alerts.find((item) => item.id === selectedId);
    if (alert?.location) {
      map.easeTo({ center: [alert.location.lon, alert.location.lat], padding, duration: 450 });
    } else {
      map.easeTo({ padding, duration: 300 });
    }
    // Only when the selection changes, not on every list update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, detailOpen, wide, ready]);

  return (
    <div className="map-stage">
      <div ref={containerRef} className="map" role="region" aria-label="Карта заказника" />
      <div className="map-top">
        <span className="chip chip-sim map-sim">
          <FlaskConical size={14} aria-hidden="true" />
          Датчики и сценарий — симуляция
        </span>
        <div className="legend map-panel">
          <button
            type="button"
            className="legend-toggle"
            aria-expanded={legendOpen}
            aria-controls="map-legend"
            onClick={() => setLegendChoice(!legendOpen)}
          >
            <Layers size={16} aria-hidden="true" />
            Легенда
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          <div className="legend-body" id="map-legend" hidden={!legendOpen}>
            <span className="legend-row">
              <span className="legend-swatch" style={{ background: 'rgb(31 163 154 / 0.2)', border: '2px solid #5FD4C9' }} />
              Граница заказника (OpenStreetMap)
            </span>
            <span className="legend-row">
              <span className="legend-swatch" style={{ background: 'rgb(255 75 62 / 0.28)', border: '2px solid #FF4B3E' }} />
              Зона покоя — вход запрещён
            </span>
            <span className="legend-row">
              <span className="legend-swatch" style={{ border: '2px solid #F5B400' }} />
              Буферная зона
            </span>
            <span className="legend-row">
              <span className="legend-swatch" style={{ border: '2px dashed #CDBB94' }} />
              Операционная акватория
            </span>
            <span className="legend-row">
              <span className="legend-swatch" style={{ background: '#E6EDF2', borderRadius: '50%', width: 10, height: 10, margin: '0 5px' }} />
              Возможное лежбище тюленя
            </span>
            <span className="legend-note">Зоны, акватория и позиции устройств — иллюстративные</span>
          </div>
        </div>
      </div>
      <div ref={coordsRef} className="map-coords mono" aria-hidden="true" />
      {error && (
        <div className="map-message map-panel" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

type GeoJSONData = GeoJSONSourceSpecification['data'];

function addOverlays(map: MapLibreMap, geo: MapGeo): void {
  map.addSource('area', { type: 'geojson', data: geo.area as GeoJSONData });
  map.addSource('ops-area', { type: 'geojson', data: geo.opsArea as GeoJSONData });
  map.addSource('zones', { type: 'geojson', data: geo.zones as GeoJSONData });
  map.addSource('haulouts', { type: 'geojson', data: geo.haulouts as GeoJSONData });

  map.addLayer({ id: 'area-fill', type: 'fill', source: 'area', paint: { 'fill-color': '#1FA39A', 'fill-opacity': 0.1 } });
  map.addLayer({
    id: 'area-line',
    type: 'line',
    source: 'area',
    paint: { 'line-color': '#5FD4C9', 'line-width': 1.75, 'line-opacity': 0.9 },
  });
  map.addLayer({
    id: 'ops-line',
    type: 'line',
    source: 'ops-area',
    paint: { 'line-color': '#CDBB94', 'line-width': 1.25, 'line-opacity': 0.8, 'line-dasharray': [3, 3] },
  });
  map.addLayer({
    id: 'zones-buffer-line',
    type: 'line',
    source: 'zones',
    filter: ['==', ['get', 'kind'], 'buffer'],
    paint: { 'line-color': '#F5B400', 'line-width': 1.75 },
  });
  map.addLayer({
    id: 'zones-no-entry-fill',
    type: 'fill',
    source: 'zones',
    filter: ['==', ['get', 'kind'], 'no_entry'],
    paint: { 'fill-color': '#FF4B3E', 'fill-opacity': 0.2 },
  });
  map.addLayer({
    id: 'zones-no-entry-line',
    type: 'line',
    source: 'zones',
    filter: ['==', ['get', 'kind'], 'no_entry'],
    paint: { 'line-color': '#FF4B3E', 'line-width': 1.75 },
  });
  map.addLayer({
    id: 'haulouts',
    type: 'circle',
    source: 'haulouts',
    paint: {
      'circle-radius': 4,
      'circle-color': '#E6EDF2',
      'circle-stroke-color': '#050D16',
      'circle-stroke-width': 1.5,
    },
  });
}
