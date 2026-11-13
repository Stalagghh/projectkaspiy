'use client';
import { Info, OctagonExclamationPoint, TriangleExclamationPoint } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';

import type { AlertDto, Severity } from '@ecoshield/contracts';

import { TopBar } from '@/components/TopBar';
import type { MapDevice } from '@/features/map/geo-types';
import { SEVERITY_LABEL } from '@/lib/labels';

import { AlertDetail } from './AlertDetail';
import { AlertFeed } from './AlertFeed';
import { LiveIndicator } from './LiveIndicator';
import { ScenarioButton, ScenarioProgress, useScenario } from './ScenarioButton';
import { StationsPanel } from './StationsPanel';
import { useLiveAlerts } from './useLiveAlerts';

// MapLibre needs the browser (WebGL, workers): load it only on the client.
const MapView = dynamic(() => import('@/features/map/MapView'), {
  ssr: false,
  loading: () => <div className="map-stage" aria-busy="true" />,
});

type Filter = 'active' | 'all';

/** An alert stays in the inspector's queue until it is resolved or marked as a false alarm. */
const isActive = (alert: AlertDto): boolean => alert.status !== 'resolved' && alert.status !== 'false_positive';

const TALLY: ReadonlyArray<{ severity: Severity; Icon: typeof Info }> = [
  { severity: 'critical', Icon: OctagonExclamationPoint },
  { severity: 'warning', Icon: TriangleExclamationPoint },
  { severity: 'info', Icon: Info },
];

export function Dashboard() {
  const live = useLiveAlerts();
  const scenario = useScenario();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [extraAlert, setExtraAlert] = useState<AlertDto | null>(null);
  const [filter, setFilter] = useState<Filter>('active');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [devices, setDevices] = useState<MapDevice[]>([]);

  const selected = live.alerts.find((alert) => alert.id === selectedId) ?? (extraAlert?.id === selectedId ? extraAlert : null);
  const active = live.alerts.filter(isActive);
  const shown = filter === 'active' ? active : live.alerts;

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

  const closeDetail = useCallback(() => setSelectedId(null), []);
  const reloadSelected = useCallback(() => {
    void live.reload();
  }, [live]);

  return (
    <div className="app app-fixed app-sheet">
      <TopBar>
        <LiveIndicator state={live.sseState} lastUpdateAt={live.lastUpdateAt} />
        <ScenarioButton scenario={scenario} />
      </TopBar>

      <main className="main main-sheet">
        <div className="map-col">
          <MapView
            alerts={live.alerts}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onDevices={setDevices}
            detailOpen={selected !== null}
          />
          <StationsPanel devices={devices} subscribeReadings={live.subscribeReadings} />
          {selected && (
            <aside className="detail-overlay" aria-label="Карточка тревоги">
              <AlertDetail
                key={selected.id}
                alert={selected}
                onClose={closeDetail}
                onUpdated={(alert) => {
                  live.applyAlert(alert);
                  if (extraAlert?.id === alert.id) setExtraAlert(alert);
                }}
                onConflict={reloadSelected}
              />
            </aside>
          )}
        </div>

        <section className="side" aria-labelledby="feed-title" data-open={sheetOpen}>
          <button
            type="button"
            className="sheet-handle"
            aria-expanded={sheetOpen}
            aria-controls="alert-feed"
            onClick={() => setSheetOpen((open) => !open)}
          >
            <span className="sheet-grip" aria-hidden="true" />
            <span className="sr-only">{sheetOpen ? 'Свернуть ленту тревог' : 'Развернуть ленту тревог'}</span>
          </button>
          <header className="side-head">
            {/* On a phone the whole title row toggles the sheet; the handle above is the keyboard control. */}
            <div className="side-head-row" onClick={() => setSheetOpen((open) => !open)}>
              <h2 className="side-title" id="feed-title">
                Лента тревог
              </h2>
              <span className="tally" aria-label="Активные тревоги по серьёзности">
                {TALLY.map(({ severity, Icon }) => {
                  const count = active.filter((alert) => alert.severity === severity).length;
                  return (
                    <span key={severity} className="tally-item" data-severity={severity} data-on={count > 0}>
                      <Icon size={15} aria-hidden="true" />
                      <span className="sr-only">{SEVERITY_LABEL[severity]}:</span>
                      <span className="num">{count}</span>
                    </span>
                  );
                })}
              </span>
            </div>
            <div className="seg" role="group" aria-label="Какие тревоги показывать">
              <button type="button" aria-pressed={filter === 'active'} onClick={() => setFilter('active')}>
                Активные <span className="num">{active.length}</span>
              </button>
              <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
                Все <span className="num">{live.alerts.length}</span>
              </button>
            </div>
          </header>
          <ScenarioProgress scenario={scenario} />
          <AlertFeed
            alerts={shown}
            hiddenCount={live.alerts.length - shown.length}
            loadState={live.loadState}
            selectedId={selectedId}
            freshIds={live.freshIds}
            onSelect={setSelectedId}
            onShowAll={() => setFilter('all')}
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
