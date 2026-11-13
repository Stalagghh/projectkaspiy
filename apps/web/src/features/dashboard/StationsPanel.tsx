'use client';
// Live readouts of the water quality stations. Values arrive over the same SSE stream as alerts.
import { ChevronDown, Droplets } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { MapDevice } from '@/features/map/geo-types';
import { METRIC_LABEL } from '@/lib/labels';
import { useNow } from '@/lib/useNow';

/** Stations report every 5 s; after this long without a report the row is marked as stale. */
const STALE_AFTER_MS = 20_000;

const COLUMNS = [
  { metric: 'water_temp_c', head: 't, °C' },
  { metric: 'conductivity_us_cm', head: 'мкСм/см' },
  { metric: 'turbidity_ntu', head: 'NTU' },
] as const;

type Props = {
  devices: MapDevice[];
  loadState?: 'loading' | 'ready' | 'error';
  onRetry?: () => void;
};

function formatValue(metric: string, value: number | null): string {
  if (value === null) return '—';
  const digits = METRIC_LABEL[metric]?.digits ?? 1;
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

export function StationsPanel({ devices, loadState, onRetry }: Props) {
  const now = useNow();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const reveal = () => { if (window.location.hash === '#stations') setOpen(true); };
    reveal();
    window.addEventListener('hashchange', reveal);
    return () => window.removeEventListener('hashchange', reveal);
  }, []);
  useEffect(() => {
    if (!open || window.location.hash !== '#stations') return;
    const section = document.getElementById('stations');
    const dashboard = section?.closest('main');
    if (!section || !dashboard) return;
    let frame = 0;
    let active = true;
    const align = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { if (active) section.scrollIntoView({ block: 'start' }); });
    };
    // Forecast/audio content can finish loading after this section opens. Keep the requested
    // destination visible during that layout settling, until the user starts another interaction.
    const observer = new ResizeObserver(align);
    observer.observe(dashboard);
    observer.observe(section);
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    const stop = () => {
      active = false;
      observer.disconnect();
      cancelAnimationFrame(frame);
      for (const event of events) window.removeEventListener(event, stop);
    };
    for (const event of events) window.addEventListener(event, stop, { passive: true });
    section.focus({ preventScroll: true });
    align();
    return stop;
  }, [open]);

  const stations = devices.filter((device) => device.kind === 'water_station');
  const simulated = stations.some((station) => station.isSimulated);

  return (
    <section className="stations overview-panel" id="stations" tabIndex={-1} aria-labelledby="stations-title">
      <h2 className="stations-head" id="stations-title">
        <button
          type="button"
          className="legend-toggle"
          aria-expanded={open}
          aria-controls="stations-body"
          onClick={() => setOpen(!open)}
        >
          <Droplets size={16} aria-hidden="true" />
          Датчики · качество воды
          {simulated && <span className="chip chip-sim">симуляция</span>}
          <ChevronDown size={16} aria-hidden="true" />
        </button>
      </h2>
      <div className="stations-body" id="stations-body" hidden={!open}>
        {stations.length === 0 ? (
            <p className="stations-empty">{loadState === 'error' ? 'Не удалось загрузить станции.' : loadState === 'loading' ? 'Загрузка станций…' : 'Станций в реестре пока нет.'}{onRetry && <button className="text-link" type="button" onClick={onRetry}>Повторить</button>}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Станция</th>
                {COLUMNS.map((column) => (
                  <th key={column.metric} scope="col" title={METRIC_LABEL[column.metric]?.label}>
                    <span className="sr-only">{METRIC_LABEL[column.metric]?.label}, </span>
                    {column.head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stations.map((station) => {
                const cells = COLUMNS.map((column) => {
                  const sensor = station.sensors.find((item) => item.metric === column.metric);
                  const latest = sensor ?? null;
                  return { metric: column.metric, latest };
                });
                const newest = Math.max(0, ...cells.map((cell) => (cell.latest?.ts ? Date.parse(cell.latest.ts) : 0)));
                const stale = now !== null && now - newest > STALE_AFTER_MS;
                return (
                  <tr key={station.id} data-stale={stale}>
                    <td>
                      <span className="station-name">
                        <span className="station-dot" aria-hidden="true" />
                        {station.name.replace('Станция воды', 'Ст.')}
                        {stale && <span className="sr-only"> — нет свежих данных</span>}
                      </span>
                    </td>
                    {cells.map(({ metric, latest }) => (
                      <td key={metric} className="num" data-quality={latest?.quality ?? undefined}>
                        {/* The key restarts the short highlight each time a new reading arrives. */}
                        <span key={latest?.ts ?? 'none'} className="reading">
                          {formatValue(metric, latest?.value ?? null)}
                        </span>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
