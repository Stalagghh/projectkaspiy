'use client';
// MapLibre GL 6 map with the offline Protomaps basemap (PMTiles served by our own route).
// The map instance lives in a ref and is created once; live updates only touch marker DOM.
import 'maplibre-gl/dist/maplibre-gl.css';

import { layers, namedFlavor } from '@protomaps/basemaps';
import { Droplets, Info, OctagonExclamationPoint, Radio, TriangleExclamationPoint } from 'lucide-react';
import {
  addProtocol,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSourceSpecification,
  type LayerSpecification,
  type StyleSpecification,
} from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { AlertDto, ReadingDto, Severity } from '@ecoshield/contracts';

import type { DeviceSensor, MapGeo } from '@/features/map/geo-types';
import { formatMetric, formatTime, KIND_LABEL, METRIC_LABEL, SEVERITY_LABEL, STATUS_LABEL } from '@/lib/labels';

const ATTRIBUTION = '© участники OpenStreetMap (ODbL), Protomaps';
const FALLBACK_CENTER: [number, number] = [47.45, 43.65];
const PULSE_WINDOW_MS = 60_000;

let protocolRegistered = false;
function registerPmtiles(): void {
  if (protocolRegistered) return;
  const protocol = new Protocol();
  addProtocol('pmtiles', protocol.tile);
  setWorkerUrl(`${window.location.origin}/vendor/maplibre-worker`);
  protocolRegistered = true;
}

/** Protomaps dark flavor without symbol layers: no glyphs or sprites, so no external requests. */
function buildStyle(): StyleSpecification {
  const base = layers('protomaps', namedFlavor('dark'), { lang: 'ru' }).filter(
    (layer: LayerSpecification) => layer.type !== 'symbol',
  );
  return {
    version: 8,
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://${window.location.origin}/tiles/agrakhan.pmtiles`,
        attribution: ATTRIBUTION,
      },
    },
    layers: base,
  };
}

const SEVERITY_ICON: Record<Severity, ComponentType<{ size?: number; 'aria-hidden'?: boolean }>> = {
  info: Info,
  warning: TriangleExclamationPoint,
  critical: OctagonExclamationPoint,
};

type AlertMarker = { marker: Marker; el: HTMLButtonElement; root: Root; severity: Severity };
type Overlay = { roots: Root[]; markers: Marker[] };

type Props = {
  alerts: AlertDto[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  subscribeReadings: (listener: (reading: ReadingDto) => void) => () => void;
};

function deviceLabel(name: string, kind: string, sensors: DeviceSensor[]): string {
  const kindText = kind === 'water_station' ? 'Станция качества воды' : 'Акустический буй';
  const values = sensors
    .filter((sensor) => sensor.value !== null)
    .map((sensor) => `${METRIC_LABEL[sensor.metric]?.label ?? sensor.metric}: ${formatMetric(sensor.metric, sensor.value)}`);
  return [`${kindText} ${name}`, ...values].join(', ');
}

function alertLabel(alert: AlertDto): string {
  return `${SEVERITY_LABEL[alert.severity]}: ${KIND_LABEL[alert.kind]}, ${alert.deviceName ?? 'устройство не указано'}, ${formatTime(
    alert.eventAt,
  )}, ${STATUS_LABEL[alert.status]}`;
}

export default function MapView({ alerts, selectedId, onSelect, subscribeReadings }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const alertMarkers = useRef(new Map<string, AlertMarker>());
  const deviceEls = useRef(new Map<string, HTMLElement>());
  const onSelectRef = useRef(onSelect);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

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
    map.addControl(new NavigationControl({ showCompass: false }), 'top-left');

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
          for (const feature of geo.devices.features) {
            const props = feature.properties as {
              id: string;
              kind: string;
              name: string;
              sensors: DeviceSensor[];
            };
            const [lon, lat] = feature.geometry.coordinates as [number, number];
            const el = document.createElement('div');
            el.className = 'dev-marker';
            el.setAttribute('role', 'img');
            el.setAttribute('aria-label', deviceLabel(props.name, props.kind, props.sensors));
            el.dataset.deviceId = props.id;
            const iconEl = document.createElement('span');
            iconEl.style.display = 'inline-flex';
            el.append(iconEl);
            const root = createRoot(iconEl);
            const Icon = props.kind === 'water_station' ? Droplets : Radio;
            root.render(<Icon size={16} aria-hidden={true} />);
            overlay.roots.push(root);
            const nameEl = document.createElement('span');
            nameEl.textContent = props.name;
            el.append(nameEl);
            if (props.kind === 'water_station' && props.sensors.length > 0) {
              const values = document.createElement('span');
              values.className = 'dev-values';
              const order = Object.keys(METRIC_LABEL);
              const sorted = [...props.sensors].sort((a, b) => order.indexOf(a.metric) - order.indexOf(b.metric));
              for (const sensor of sorted) {
                const value = document.createElement('span');
                value.dataset.sensorId = sensor.sensorId;
                value.dataset.quality = sensor.quality ?? 'ok';
                value.textContent = formatMetric(sensor.metric, sensor.value);
                values.append(value);
              }
              el.append(values);
            }
            el.dataset.sensors = JSON.stringify(props.sensors);
            deviceEls.current.set(props.id, el);
            overlay.markers.push(new Marker({ element: el, anchor: 'left', offset: [-12, 0] }).setLngLat([lon, lat]).addTo(map));
          }
          if (geo.opsBounds) {
            const [west, south, east, north] = geo.opsBounds;
            map.fitBounds(
              [
                [west, south],
                [east, north],
              ],
              { padding: 40, duration: 0 },
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
    const devices = deviceEls.current;
    return () => {
      disposed = true;
      for (const marker of overlay.markers) marker.remove();
      for (const { marker, root } of markers.values()) {
        marker.remove();
        root.unmount();
      }
      markers.clear();
      devices.clear();
      const roots = [...overlay.roots];
      // Unmount marker roots after the current render pass.
      queueMicrotask(() => roots.forEach((root) => root.unmount()));
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Live water readings: update only the text of the marker element.
  useEffect(
    () =>
      subscribeReadings((reading) => {
        const el = deviceEls.current.get(reading.deviceId);
        if (!el) return;
        const valueEl = el.querySelector<HTMLElement>(`[data-sensor-id="${CSS.escape(reading.sensorId)}"]`);
        if (valueEl) {
          valueEl.textContent = formatMetric(reading.metric, reading.value);
          valueEl.dataset.quality = reading.quality;
        }
        try {
          const sensors = JSON.parse(el.dataset.sensors ?? '[]') as DeviceSensor[];
          const next = sensors.map((sensor) =>
            sensor.sensorId === reading.sensorId
              ? { ...sensor, value: reading.value, ts: reading.ts, quality: reading.quality }
              : sensor,
          );
          el.dataset.sensors = JSON.stringify(next);
          const name = el.querySelector('span:nth-of-type(2)')?.textContent ?? '';
          el.setAttribute('aria-label', deviceLabel(name, 'water_station', next));
        } catch {
          // keep the previous label
        }
      }),
    [subscribeReadings],
  );

  // Alert markers: add, update and remove without touching the map instance.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const seen = new Set<string>();
    for (const alert of alerts) {
      if (!alert.location) continue;
      seen.add(alert.id);
      let entry = alertMarkers.current.get(alert.id);
      if (!entry) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'alert-marker';
        el.addEventListener('click', (event) => {
          event.stopPropagation();
          onSelectRef.current(alert.id);
        });
        if (alert.severity === 'critical' && Date.now() - Date.parse(alert.createdAt) < PULSE_WINDOW_MS) {
          el.classList.add('is-pulsing');
        }
        const root = createRoot(el);
        entry = {
          el,
          root,
          severity: alert.severity,
          marker: new Marker({ element: el }).setLngLat([alert.location.lon, alert.location.lat]).addTo(map),
        };
        alertMarkers.current.set(alert.id, entry);
        const Icon = SEVERITY_ICON[alert.severity];
        root.render(<Icon size={18} aria-hidden={true} />);
      }
      entry.el.dataset.severity = alert.severity;
      entry.el.dataset.status = alert.status;
      entry.el.dataset.alertId = alert.id;
      entry.el.setAttribute('aria-label', alertLabel(alert));
      entry.el.classList.toggle('is-selected', alert.id === selectedId);
      entry.marker.setLngLat([alert.location.lon, alert.location.lat]);
      if (entry.severity !== alert.severity) {
        const Icon = SEVERITY_ICON[alert.severity];
        entry.root.render(<Icon size={18} aria-hidden={true} />);
        entry.severity = alert.severity;
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

  // Bring the selected alert into view.
  useEffect(() => {
    const map = mapRef.current;
    const alert = alerts.find((item) => item.id === selectedId);
    if (!map || !ready || !alert?.location) return;
    map.easeTo({ center: [alert.location.lon, alert.location.lat], duration: 400 });
    // Only when the selection changes, not on every list update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, ready]);

  return (
    <div className="map-stage">
      <div ref={containerRef} className="map" role="region" aria-label="Карта заказника" />
      <div className="legend" aria-label="Легенда карты">
        <span className="legend-row">
          <span className="legend-swatch" style={{ background: 'rgb(31 163 154 / 0.18)', border: '2px solid #1FA39A' }} />
          Граница заказника
        </span>
        <span className="legend-row">
          <span className="legend-swatch" style={{ border: '2px dashed #CDBB94' }} />
          Операционная акватория
        </span>
        <span className="legend-row">
          <span className="legend-swatch" style={{ background: 'rgb(255 75 62 / 0.3)', border: '2px solid #FF4B3E' }} />
          Зона покоя (запрет входа)
        </span>
        <span className="legend-row">
          <span className="legend-swatch" style={{ border: '2px solid #F5B400' }} />
          Буферная зона
        </span>
        <span className="legend-row">
          <span className="legend-swatch" style={{ background: '#E9EEF1', borderRadius: '50%', width: 10, height: 10 }} />
          Возможные лежбища тюленя
        </span>
        <span className="legend-note">Зоны и позиции — иллюстративно</span>
      </div>
      {error && (
        <div className="map-message" role="alert">
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

  map.addLayer({ id: 'area-fill', type: 'fill', source: 'area', paint: { 'fill-color': '#1FA39A', 'fill-opacity': 0.08 } });
  map.addLayer({ id: 'area-line', type: 'line', source: 'area', paint: { 'line-color': '#1FA39A', 'line-width': 2 } });
  map.addLayer({
    id: 'ops-line',
    type: 'line',
    source: 'ops-area',
    paint: { 'line-color': '#CDBB94', 'line-width': 1.5, 'line-dasharray': [3, 2] },
  });
  map.addLayer({
    id: 'zones-no-entry-fill',
    type: 'fill',
    source: 'zones',
    filter: ['==', ['get', 'kind'], 'no_entry'],
    paint: { 'fill-color': '#FF4B3E', 'fill-opacity': 0.22 },
  });
  map.addLayer({
    id: 'zones-no-entry-line',
    type: 'line',
    source: 'zones',
    filter: ['==', ['get', 'kind'], 'no_entry'],
    paint: { 'line-color': '#FF4B3E', 'line-width': 1.5 },
  });
  map.addLayer({
    id: 'zones-buffer-line',
    type: 'line',
    source: 'zones',
    filter: ['==', ['get', 'kind'], 'buffer'],
    paint: { 'line-color': '#F5B400', 'line-width': 2 },
  });
  map.addLayer({
    id: 'haulouts',
    type: 'circle',
    source: 'haulouts',
    paint: {
      'circle-radius': 4,
      'circle-color': '#E9EEF1',
      'circle-stroke-color': '#07111C',
      'circle-stroke-width': 1.5,
    },
  });
}
