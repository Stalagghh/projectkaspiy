'use client';
import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { AlertDto } from '@ecoshield/contracts';

import { formatPercent, formatRelative, formatTime, KIND_LABEL, QUALITATIVE_LABEL, STATUS_LABEL } from '@/lib/labels';

import { SeverityBadge } from './SeverityBadge';
import type { LoadState } from './useLiveAlerts';

type Props = {
  alerts: AlertDto[];
  loadState: LoadState;
  selectedId: string | null;
  freshIds: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onRetry: () => void;
};

export function AlertFeed({ alerts, loadState, selectedId, freshIds, onSelect, onRetry }: Props) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  if (loadState === 'loading' && alerts.length === 0) {
    return (
      <div className="feed" data-testid="alert-feed" aria-busy="true">
        <ul aria-label="Загрузка тревог">
          {[0, 1, 2].map((i) => (
            <li key={i} className="skeleton" />
          ))}
        </ul>
      </div>
    );
  }

  if (loadState === 'error' && alerts.length === 0) {
    return (
      <div className="feed" data-testid="alert-feed">
        <div className="state-box" role="alert">
          Не удалось загрузить тревоги.
          <button type="button" className="btn" onClick={onRetry}>
            <RefreshCw size={16} aria-hidden="true" />
            Повторить
          </button>
        </div>
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div className="feed" data-testid="alert-feed">
        <div className="state-box">Тревог пока нет — запустите сценарий</div>
      </div>
    );
  }

  return (
    <div className="feed" data-testid="alert-feed">
      <ul>
        {alerts.map((alert) => (
          <li key={alert.id} className={freshIds.has(alert.id) ? 'feed-enter' : undefined}>
            <button
              type="button"
              className="alert-item"
              data-testid="alert-item"
              data-alert-id={alert.id}
              data-kind={alert.kind}
              data-severity={alert.severity}
              data-status={alert.status}
              aria-pressed={alert.id === selectedId}
              onClick={() => onSelect(alert.id)}
            >
              <span className="alert-row">
                <SeverityBadge severity={alert.severity} />
                <span className="alert-row" style={{ gap: 6 }}>
                  {alert.isSimulated && <span className="chip chip-sim">СИМУЛЯЦИЯ</span>}
                  <span className="chip chip-status" data-status={alert.status}>
                    {STATUS_LABEL[alert.status]}
                  </span>
                </span>
              </span>
              <span className="alert-kind">{KIND_LABEL[alert.kind]}</span>
              <span className="alert-meta">
                {[alert.deviceName, alert.zoneName].filter(Boolean).join(' · ') || 'Устройство не указано'}
              </span>
              <span className="alert-row alert-meta">
                <span>
                  {now !== null && <>{formatRelative(alert.eventAt, now)} · </>}
                  <time className="num" dateTime={alert.eventAt}>
                    {formatTime(alert.eventAt)}
                  </time>
                </span>
                {alert.detection && (
                  <span>
                    <span className="num">{formatPercent(alert.detection.confidence)}</span>,{' '}
                    {QUALITATIVE_LABEL[alert.detection.qualitative]}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
