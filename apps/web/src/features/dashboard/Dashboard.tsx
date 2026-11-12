'use client';
import { FlaskConical } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';

import type { AlertDto } from '@ecoshield/contracts';

import { TopBar } from '@/components/TopBar';

import { AlertDetail } from './AlertDetail';
import { AlertFeed } from './AlertFeed';
import { LiveIndicator } from './LiveIndicator';
import { ScenarioButton } from './ScenarioButton';
import { useLiveAlerts } from './useLiveAlerts';

// MapLibre needs the browser (WebGL, workers): load it only on the client.
const MapView = dynamic(() => import('@/features/map/MapView'), {
  ssr: false,
  loading: () => <div className="map-stage" aria-busy="true" />,
});

export function Dashboard() {
  const live = useLiveAlerts();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [extraAlert, setExtraAlert] = useState<AlertDto | null>(null);

  const selected = live.alerts.find((alert) => alert.id === selectedId) ?? (extraAlert?.id === selectedId ? extraAlert : null);

  // A selected alert that dropped out of the list (older than the latest 50) is loaded by id.
  useEffect(() => {
    if (!selectedId || live.alerts.some((alert) => alert.id === selectedId)) return;
    let cancelled = false;
    fetch(`/api/alerts/${selectedId}`, { cache: 'no-store' })
      .then(async (response) => (response.ok ? ((await response.json()) as AlertDto) : null))
      .then((alert) => {
        if (!cancelled) setExtraAlert(alert);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [selectedId, live.alerts]);

  const reloadSelected = useCallback(() => {
    void live.reload();
  }, [live]);

  return (
    <div className="app">
      <TopBar>
        <span className="sim-badge">
          <FlaskConical size={14} aria-hidden="true" />
          Данные датчиков и сценарий — симуляция
        </span>
        <LiveIndicator state={live.sseState} lastUpdateAt={live.lastUpdateAt} />
        <ScenarioButton />
      </TopBar>

      <main className="main">
        <div className="map-col">
          <MapView
            alerts={live.alerts}
            selectedId={selectedId}
            onSelect={setSelectedId}
            subscribeReadings={live.subscribeReadings}
          />
          {selected && (
            <aside className="detail-overlay" aria-label="Карточка тревоги">
              <AlertDetail
                key={selected.id}
                alert={selected}
                onClose={() => setSelectedId(null)}
                onUpdated={(alert) => {
                  live.applyAlert(alert);
                  if (extraAlert?.id === alert.id) setExtraAlert(alert);
                }}
                onConflict={reloadSelected}
              />
            </aside>
          )}
        </div>
        <section className="side" aria-labelledby="feed-title">
          <h2 className="panel-title" id="feed-title" style={{ margin: 0 }}>
            Лента тревог
            <span className="num" aria-hidden="true">
              {live.alerts.length}
            </span>
          </h2>
          <AlertFeed
            alerts={live.alerts}
            loadState={live.loadState}
            selectedId={selectedId}
            freshIds={live.freshIds}
            onSelect={setSelectedId}
            onRetry={() => void live.reload()}
          />
        </section>
      </main>
      <div className="sr-only" aria-live="polite" role="status">
        {live.announcement}
      </div>
    </div>
  );
}
