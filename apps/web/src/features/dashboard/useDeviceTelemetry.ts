'use client';
import { useCallback, useEffect, useState } from 'react';

import type { MapDevice, MapGeo } from '@/features/map/geo-types';

import type { ReadingListener } from './useLiveAlerts';

const newer = (candidate: string | null, previous: string | null) => candidate !== null && (previous === null || Date.parse(candidate) > Date.parse(previous));

export function useDeviceTelemetry(subscribe: (listener: ReadingListener) => () => void) {
  const [devices, setDevices] = useState<MapDevice[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/map/geo', { cache: 'no-store', signal });
      if (!response.ok) throw new Error('devices unavailable');
      const geo = await response.json() as MapGeo;
      if (signal?.aborted) return;
      setDevices((previous) => geo.devices.features.map((feature) => {
        const snapshot = feature.properties as MapDevice;
        const current = previous.find((device) => device.id === snapshot.id);
        if (!current) return snapshot;
        return {
          ...snapshot,
          lastSeenAt: newer(current.lastSeenAt, snapshot.lastSeenAt) ? current.lastSeenAt : snapshot.lastSeenAt,
          sensors: snapshot.sensors.map((sensor) => {
            const latest = current.sensors.find((item) => item.sensorId === sensor.sensorId);
            return latest && newer(latest.ts, sensor.ts) ? latest : sensor;
          }),
        };
      }));
      setStatus('ready');
    } catch {
      if (!signal?.aborted) setStatus('error');
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state changes only after the HTTP request settles
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  useEffect(() => subscribe((reading) => {
    setDevices((previous) => previous.map((device) => {
      if (!device.sensors.some((sensor) => sensor.sensorId === reading.sensorId)) return device;
      return {
        ...device,
        lastSeenAt: newer(reading.ts, device.lastSeenAt) ? reading.ts : device.lastSeenAt,
        sensors: device.sensors.map((sensor) => sensor.sensorId === reading.sensorId && newer(reading.ts, sensor.ts) ? { ...sensor, value: reading.value, ts: reading.ts, quality: reading.quality } : sensor),
      };
    }));
  }), [subscribe]);
  // Refresh buoy lastSeenAt too: audio clips do not produce water-reading events.
  useEffect(() => {
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);
  return { devices, status, reload: load };
}
