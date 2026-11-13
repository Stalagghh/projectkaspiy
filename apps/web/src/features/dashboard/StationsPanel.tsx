'use client';
// Live readouts of the water quality stations. Values arrive over the same SSE stream as alerts.
import { ChevronDown, Droplets } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { ReadingDto } from '@ecoshield/contracts';

import type { DeviceSensor, MapDevice } from '@/features/map/geo-types';
import { METRIC_LABEL } from '@/lib/labels';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useNow } from '@/lib/useNow';

/** Stations report every 5 s; after this long without a report the row is marked as stale. */
const STALE_AFTER_MS = 20_000;

const COLUMNS = [
  { metric: 'water_temp_c', head: 't, °C' },
  { metric: 'conductivity_us_cm', head: 'мкСм/см' },
  { metric: 'turbidity_ntu', head: 'NTU' },
] as const;

type Latest = Pick<DeviceSensor, 'value' | 'ts' | 'quality'>;

type Props = {
  devices: MapDevice[];
  subscribeReadings: (listener: (reading: ReadingDto) => void) => () => void;
};

function formatValue(metric: string, value: number | null): string {
  if (value === null) return '—';
  const digits = METRIC_LABEL[metric]?.digits ?? 1;
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

export function StationsPanel({ devices, subscribeReadings }: Props) {
  const now = useNow();
  // Open where there is room (desktop); on a phone the table would hide the map, so it starts closed.
  const wide = useMediaQuery('(min-width: 900px)', true);
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? wide;
  // Readings received after the page loaded, by sensor id. Older values come with `devices`.
  const [live, setLive] = useState<ReadonlyMap<string, Latest>>(new Map());

  useEffect(
    () =>
      subscribeReadings((reading) => {
        setLive((previous) => {
          const next = new Map(previous);
          next.set(reading.sensorId, { value: reading.value, ts: reading.ts, quality: reading.quality });
          return next;
        });
      }),
    [subscribeReadings],
  );

  const stations = devices.filter((device) => device.kind === 'water_station');
  const simulated = stations.some((station) => station.isSimulated);

  return (
    <section className="stations map-panel" aria-labelledby="stations-title">
      <h2 className="stations-head" id="stations-title">
        <button
          type="button"
          className="legend-toggle"
          aria-expanded={open}
          aria-controls="stations-body"
          onClick={() => setChoice(!open)}
        >
          <Droplets size={16} aria-hidden="true" />
          Качество воды
          {simulated && <span className="chip chip-sim">симуляция</span>}
          <ChevronDown size={16} aria-hidden="true" />
        </button>
      </h2>
      <div className="stations-body" id="stations-body" hidden={!open}>
        {stations.length === 0 ? (
          <p className="stations-empty">Станции появятся после загрузки карты.</p>
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
                  const latest = sensor ? (live.get(sensor.sensorId) ?? sensor) : null;
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
