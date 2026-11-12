'use client';
// Alert list + Server-Sent Events. Reloads the list on every (re)connect: there is no replay buffer.
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  alertDtoSchema,
  alertEventSchema,
  readingDtoSchema,
  SSE_EVENT,
  type AlertDto,
  type ReadingDto,
} from '@ecoshield/contracts';

import { KIND_LABEL, SEVERITY_LABEL, sortAlerts } from '@/lib/labels';

export type SseState = 'open' | 'connecting' | 'closed';
export type LoadState = 'loading' | 'ready' | 'error';
export type ReadingListener = (reading: ReadingDto) => void;

const MAX_ALERTS = 100;

function upsert(list: AlertDto[], alert: AlertDto): AlertDto[] {
  const existing = list.find((item) => item.id === alert.id);
  if (existing && existing.version > alert.version) return list;
  return sortAlerts([alert, ...list.filter((item) => item.id !== alert.id)]).slice(0, MAX_ALERTS);
}

export function useLiveAlerts() {
  const [alerts, setAlerts] = useState<AlertDto[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [sseState, setSseState] = useState<SseState>('connecting');
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [freshIds, setFreshIds] = useState<ReadonlySet<string>>(new Set());
  const readingListeners = useRef(new Set<ReadingListener>());
  const loadSeq = useRef(0);

  const loadAlerts = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const response = await fetch('/api/alerts', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { alerts?: unknown[] };
      const parsed = (body.alerts ?? [])
        .map((item) => alertDtoSchema.safeParse(item))
        .filter((result) => result.success)
        .map((result) => result.data);
      if (seq !== loadSeq.current) return;
      setAlerts(sortAlerts(parsed));
      setLoadState('ready');
      setLastUpdateAt(Date.now());
    } catch {
      if (seq !== loadSeq.current) return;
      setLoadState((previous) => (previous === 'ready' ? 'ready' : 'error'));
    }
  }, []);

  const applyAlert = useCallback((alert: AlertDto) => {
    setAlerts((list) => upsert(list, alert));
    setLastUpdateAt(Date.now());
  }, []);

  const subscribeReadings = useCallback((listener: ReadingListener) => {
    readingListeners.current.add(listener);
    return () => {
      readingListeners.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      setSseState('connecting');
      const es = new EventSource('/api/stream');
      source = es;
      // The list is (re)loaded on every open: there is no replay buffer.
      es.onopen = () => {
        attempt = 0;
        setSseState('open');
        void loadAlerts();
      };
      es.onerror = () => {
        // Without the stream, still load the list over plain HTTP (shows data or the error
        // state); it is reloaded again on the next successful open.
        void loadAlerts();
        if (es.readyState === EventSource.CLOSED) {
          // The browser gave up (e.g. 503): retry the stream ourselves with backoff.
          setSseState('closed');
          es.close();
          const delay = Math.min(30_000, 1000 * 2 ** attempt);
          attempt += 1;
          retryTimer = setTimeout(connect, delay);
        } else {
          setSseState('connecting');
        }
      };
      es.addEventListener(SSE_EVENT.alert, (event) => {
        const parsed = alertEventSchema.safeParse(JSON.parse((event as MessageEvent<string>).data));
        if (!parsed.success) return;
        const { op, alert } = parsed.data;
        applyAlert(alert);
        if (op === 'created') {
          setFreshIds((ids) => new Set(ids).add(alert.id));
          setAnnouncement(
            `Новая тревога: ${KIND_LABEL[alert.kind]}, ${SEVERITY_LABEL[alert.severity]}${
              alert.deviceName ? `, ${alert.deviceName}` : ''
            }`,
          );
        }
      });
      es.addEventListener(SSE_EVENT.reading, (event) => {
        const parsed = readingDtoSchema.safeParse(JSON.parse((event as MessageEvent<string>).data));
        if (!parsed.success) return;
        setLastUpdateAt(Date.now());
        for (const listener of readingListeners.current) listener(parsed.data);
      });
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      source?.close();
    };
  }, [applyAlert, loadAlerts]);

  return {
    alerts,
    loadState,
    sseState,
    lastUpdateAt,
    announcement,
    freshIds,
    reload: loadAlerts,
    applyAlert,
    subscribeReadings,
  };
}
