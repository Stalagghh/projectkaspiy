'use client';
// MapLibre GL 6 map with the offline Protomaps basemap (PMTiles served by our own route).
// The map instance lives in a ref and is created once; live updates only touch marker DOM.
import 'maplibre-gl/dist/maplibre-gl.css';

import { ChevronDown, Droplets, FlaskConical, Layers, Map as MapIcon, Radio } from 'lucide-react';
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
import { useNow } from '@/lib/useNow';

const FALLBACK_CENTER: [number, number] = [47.45, 43.65];
/** Open sea east of the Agrakhan peninsula: where the name of the sea is written. */
const SEA_LABEL_AT: [number, number] = [48.02, 43.72];
/** Alerts at the same buoy overlap: the most severe (and the selected one) stays on top. */
const SEVERITY_Z: Record<Severity, number> = { info: 1, warning: 2, critical: 3 };
/** Unresolved alerts at one buoy fan out by this many pixels so that each stays clickable. */
const STACK_STEP_PX = 22;
/** Further alerts at the same place sit under the last fanned-out one. */
const STACK_MAX = 3;

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
  devices?: MapDevice[];
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

export default function MapView({ alerts, selectedId, onSelect, onDevices, devices }: Props) {
  const now = useNow();
  const containerRef = useRef<HTMLDivElement>(null);
  const coordsRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const alertMarkers = useRef(new Map<string, AlertMarker>());
  const onSelectRef = useRef(onSelect);
  const onDevicesRef = useRef(onDevices);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [visibility, setVisibility] = useState({ reserve: true, zones: true, devices: true, alerts: true });

  useEffect(() => {
    onSelectRef.current = onSelect;
    onDevicesRef.current = onDevices;
  }, [onSelect, onDevices]);

  // Create the map once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    registerPmtiles();
    let map: MapLibreMap;
    try { map = new MapLibreMap({
      container,
      style: buildStyle(),
      center: FALLBACK_CENTER,
      zoom: 9,
      attributionControl: { compact: false },
    }); } catch {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- surface failure of an external WebGL resource
      setError('WebGL недоступен. События и показания доступны в списках.');
      return;
    }
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new ScaleControl({ unit: 'metric', maxWidth: 110 }), 'bottom-right');
    const resize = new ResizeObserver(() => map.resize());
    resize.observe(container);

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
    // Attach rejection immediately, even if WebGL takes longer than the API to start.
    void geoPromise.catch(() => undefined);

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
            el.dataset.fresh = String(device.lastSeenAt !== null && Date.now() - Date.parse(device.lastSeenAt) <= 20_000);
            el.setAttribute('role', 'img');
            el.setAttribute('aria-label', `${isStation ? 'Станция качества воды' : 'Акустический буй'}: ${device.name}, ${el.dataset.fresh === 'true' ? 'свежие данные' : 'свежесть неизвестна'}`);
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
              { padding: { top: 68, bottom: 34, left: 40, right: 40 }, duration: 0 },
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
      if (String(event.error?.message).includes('pmtiles')) setError('Векторная подложка недоступна. Показаны географические слои.');
    });

    const markers = alertMarkers.current;
    return () => {
      disposed = true;
      resize.disconnect();
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

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const groups = { reserve: ['area-fill', 'area-line', 'ops-line'], zones: ['zones-buffer-line', 'zones-no-entry-fill', 'zones-no-entry-line'] } as const;
    for (const [group, ids] of Object.entries(groups)) for (const id of ids) map.setLayoutProperty(id, 'visibility', visibility[group as keyof typeof groups] ? 'visible' : 'none');
  }, [visibility, ready]);

  useEffect(() => {
    if (!ready || !devices) return;
    for (const el of containerRef.current?.querySelectorAll<HTMLElement>('.dev-marker') ?? []) {
      const device = devices.find((item) => item.id === el.dataset.deviceId);
      const fresh = now !== null && device?.lastSeenAt && now - Date.parse(device.lastSeenAt) <= 20_000;
      el.dataset.fresh = String(Boolean(fresh));
      el.setAttribute('aria-label', `${device?.name ?? 'Датчик'}: ${fresh ? 'свежие данные' : 'нет свежих данных, статус неизвестен'}`);
    }
  }, [devices, ready, now]);

  // Bring the selected event into view without recreating the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const padding = { top: 0, bottom: 0, left: 0, right: 0 };
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 300;
    const alert = alerts.find((item) => item.id === selectedId);
    if (alert?.location) {
      map.easeTo({ center: [alert.location.lon, alert.location.lat], padding, duration });
    } else {
      map.easeTo({ padding, duration });
    }
    // Only when the selection changes, not on every list update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, ready]);

  return (
    <div className="map-stage" data-devices={visibility.devices} data-alerts={visibility.alerts}>
      <div ref={containerRef} className="map" role="region" aria-label="Карта заказника" />
      <div className="map-top">
        <div className="map-tools">
        <span className="map-title map-panel"><MapIcon size={15} aria-hidden="true" /> Карта территории</span>
        <div className="legend map-panel">
          <button type="button" className="legend-toggle" aria-expanded={legendOpen} aria-controls="map-legend" onClick={() => setLegendOpen(!legendOpen)}><Layers size={15} aria-hidden="true" /> Слои <ChevronDown size={14} aria-hidden="true" /></button>
          <div className="legend-body" id="map-legend" hidden={!legendOpen}>
            {([{ key: 'reserve', label: 'Граница заказника · OSM' }, { key: 'zones', label: 'Зоны режима · иллюстративно' }, { key: 'devices', label: 'Датчики' }, { key: 'alerts', label: 'События' }] as const).map(({ key, label }) => <label className="legend-row" key={key}><input type="checkbox" checked={visibility[key]} onChange={(event) => setVisibility((previous) => ({ ...previous, [key]: event.target.checked }))} />{label}</label>)}
            <span className="legend-note">Зоны, акватория и позиции устройств — иллюстративные. Подложка — векторная карта.</span>
          </div>
        </div>
        </div>
        <span className="chip chip-sim map-sim">
          <FlaskConical size={14} aria-hidden="true" />
          Датчики и сценарий — симуляция
        </span>
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

  map.addLayer({ id: 'area-fill', type: 'fill', source: 'area', paint: { 'fill-color': '#6aaf80', 'fill-opacity': 0.14 } });
  map.addLayer({
    id: 'area-line',
    type: 'line',
    source: 'area',
    paint: { 'line-color': '#8dbf9c', 'line-width': 1.75, 'line-opacity': 0.9 },
  });
  map.addLayer({
    id: 'ops-line',
    type: 'line',
    source: 'ops-area',
    paint: { 'line-color': '#8b9a8b', 'line-width': 1, 'line-opacity': 0.7, 'line-dasharray': [3, 3] },
  });
  map.addLayer({
    id: 'zones-buffer-line',
    type: 'line',
    source: 'zones',
    filter: ['==', ['get', 'kind'], 'buffer'],
    paint: { 'line-color': '#c5b383', 'line-width': 1.25 },
  });
  map.addLayer({
    id: 'zones-no-entry-fill',
    type: 'fill',
    source: 'zones',
    filter: ['==', ['get', 'kind'], 'no_entry'],
    paint: { 'fill-color': '#e64949', 'fill-opacity': 0.12 },
  });
  map.addLayer({
    id: 'zones-no-entry-line',
    type: 'line',
    source: 'zones',
    filter: ['==', ['get', 'kind'], 'no_entry'],
    paint: { 'line-color': '#ce7270', 'line-width': 1.25 },
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
