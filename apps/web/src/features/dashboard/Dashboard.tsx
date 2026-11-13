'use client';
import { ChevronRight, MapPin } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';

import type { AlertDto } from '@ecoshield/contracts';

import { useLiveData } from '@/components/AppShell';
import { useForecastPreview } from '@/features/forecast/useForecastPreview';
import { useNow } from '@/lib/useNow';

import { AlertDialog } from './AlertDialog';
import { AlertFeed } from './AlertFeed';
import { AudioSummary } from './AudioSummary';
import { ForecastSummary } from './ForecastSummary';
import { ScenarioButton, ScenarioProgress, useScenario } from './ScenarioButton';
import { StationsPanel } from './StationsPanel';
import { SummaryMetrics } from './SummaryMetrics';
import { useDeviceTelemetry } from './useDeviceTelemetry';

const MapView = dynamic(() => import('@/features/map/MapView'), {
  ssr: false,
  loading: () => <div className="map-stage map-loading" aria-busy="true">Загрузка карты…</div>,
});
const isActive = (alert: AlertDto) => alert.status !== 'resolved' && alert.status !== 'false_positive';
const dateFormat = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function Dashboard() {
  const live = useLiveData();
  const telemetry = useDeviceTelemetry(live.subscribeReadings);
  const preview = useForecastPreview();
  const scenario = useScenario();
  const now = useNow();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [extraAlert, setExtraAlert] = useState<AlertDto | null>(null);
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const selected = live.alerts.find((alert) => alert.id === selectedId) ?? (extraAlert?.id === selectedId ? extraAlert : null);
  const active = live.alerts.filter(isActive);
  const shown = filter === 'active' ? active : live.alerts;
  useEffect(() => {
    if (!selectedId || live.alerts.some((alert) => alert.id === selectedId)) return;
    const controller = new AbortController();
    fetch(`/api/alerts/${selectedId}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => response.ok ? await response.json() as AlertDto : null)
      .then((alert) => { if (!controller.signal.aborted) setExtraAlert(alert); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [selectedId, live.alerts]);
  const closeDetail = useCallback(() => setSelectedId(null), []);

  return <main className="dashboard">
    <header className="dashboard-heading">
      <div><h1>Мониторинг территории</h1><p><MapPin size={15} aria-hidden="true" /> Заказник «Аграханский» <span className="heading-separator">/</span> <span>{now === null ? 'Московское время' : `${dateFormat.format(now)} МСК`}</span></p></div>
      <ScenarioButton scenario={scenario} />
    </header>
    <SummaryMetrics devices={telemetry.devices} deviceStatus={telemetry.status} activeCount={active.length} alertsReady={live.loadState === 'ready'} presence={preview.state.status === 'ready' ? preview.state.days[0]?.mean ?? null : null} />
    <div className="monitoring-grid">
      <section className="map-col dashboard-map" id="map-panel" aria-label="Карта территории">
        <MapView alerts={live.alerts} selectedId={selectedId} onSelect={setSelectedId} devices={telemetry.devices} />
      </section>
      <section className="overview-panel event-panel" aria-labelledby="feed-title">
        <header className="panel-heading"><h2 id="feed-title">Лента событий</h2><button type="button" className="text-link" onClick={() => setFilter(filter === 'active' ? 'all' : 'active')}>{filter === 'active' ? 'Все события' : 'Активные'} <ChevronRight size={15} aria-hidden="true" /></button></header>
        <div className="event-filter"><span>{filter === 'active' ? 'Требуют внимания' : 'Все доступные события'}</span><span className="event-count num">{shown.length}</span></div>
        <ScenarioProgress scenario={scenario} />
        <AlertFeed alerts={shown} hiddenCount={live.alerts.length - shown.length} loadState={live.loadState} selectedId={selectedId} freshIds={live.freshIds} onSelect={setSelectedId} onShowAll={() => setFilter('all')} onRetry={() => void live.reload()} />
        <footer className="feed-footer">Время событий — МСК · последние {live.alerts.length}</footer>
      </section>
    </div>
    <div className="dashboard-bottom"><AudioSummary alerts={live.alerts} loadState={live.loadState} onRetry={() => void live.reload()} /><ForecastSummary preview={preview} /></div>
    <StationsPanel devices={telemetry.devices} loadState={telemetry.status} onRetry={() => void telemetry.reload()} />
    {selected && <AlertDialog alert={selected} onClose={closeDetail} onUpdated={(alert) => { live.applyAlert(alert); if (extraAlert?.id === alert.id) setExtraAlert(alert); }} onConflict={() => void live.reload()} />}
  </main>;
}
