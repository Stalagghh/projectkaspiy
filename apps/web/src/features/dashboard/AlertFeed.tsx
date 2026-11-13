'use client';
import { ChevronRight, RefreshCw, ShieldCheck, TriangleExclamationPoint } from 'lucide-react';

import type { AlertDto } from '@ecoshield/contracts';

import { formatClock, formatPercent, formatRelative, KIND_LABEL, SEVERITY_LABEL, STATUS_LABEL } from '@/lib/labels';
import { useNow } from '@/lib/useNow';

import { SEVERITY_ICON } from './SeverityBadge';
import type { LoadState } from './useLiveAlerts';

type Props = {
  alerts: AlertDto[];
  /** Alerts that exist but are filtered out of this list (resolved ones in the "active" view). */
  hiddenCount: number;
  loadState: LoadState;
  selectedId: string | null;
  freshIds: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onShowAll: () => void;
  onRetry: () => void;
};

export function AlertFeed({ alerts, hiddenCount, loadState, selectedId, freshIds, onSelect, onShowAll, onRetry }: Props) {
  const now = useNow();

  if (loadState === 'loading' && alerts.length === 0) {
    return (
      <div className="feed" id="alert-feed" data-testid="alert-feed" aria-busy="true">
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
      <div className="feed" id="alert-feed" data-testid="alert-feed">
        <div className="state-box" role="alert">
          <TriangleExclamationPoint size={26} aria-hidden="true" />
          <strong>Не удалось загрузить тревоги</strong>
          Проверьте, что сервер запущен, и повторите.
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
      <div className="feed" id="alert-feed" data-testid="alert-feed">
        <div className="state-box">
          <ShieldCheck size={28} aria-hidden="true" />
          <strong>{hiddenCount > 0 ? 'Активных тревог нет' : 'Тревог пока нет'}</strong>
          {hiddenCount > 0 ? (
            <>
              Все тревоги отработаны. Буи продолжают слушать акваторию.
              <button type="button" className="btn" onClick={onShowAll}>
                Показать отработанные: <span className="num">{hiddenCount}</span>
              </button>
            </>
          ) : (
            'Буи слушают акваторию. Чтобы увидеть систему в работе, запустите сценарий.'
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="feed" id="alert-feed" data-testid="alert-feed">
      <ul>
        {alerts.map((alert) => {
          const Icon = SEVERITY_ICON[alert.severity];
          return (
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
                <span className="alert-item-icon" title={SEVERITY_LABEL[alert.severity]}>
                  <Icon size={19} aria-hidden="true" />
                </span>
                <span className="alert-item-body">
                  <span className="alert-row">
                    <span className="alert-kind">
                      <span className="sr-only">{SEVERITY_LABEL[alert.severity]}: </span>
                      {KIND_LABEL[alert.kind]}
                    </span>
                    <time className="alert-time num" dateTime={alert.eventAt}>
                      {formatClock(alert.eventAt)}
                    </time>
                  </span>
                  <span className="alert-meta">
                    {[alert.deviceName, alert.zoneName].filter(Boolean).join(' · ') || 'Устройство не указано'}
                    {now !== null && <> · {formatRelative(alert.eventAt, now)}</>}
                  </span>
                  <span className="alert-tags">
                    {alert.detection && (
                      <span className="conf">
                        <span className="conf-track" aria-hidden="true">
                          <span className="conf-fill" style={{ width: `${Math.round(alert.detection.confidence * 100)}%` }} />
                        </span>
                        <span className="num">{formatPercent(alert.detection.confidence)}</span>
                        <span className="conf-label">ИИ</span>
                      </span>
                    )}
                    {alert.isSimulated && <span className="chip chip-sim">симуляция</span>}
                    <span className="chip chip-status" data-status={alert.status}>
                      {STATUS_LABEL[alert.status]}
                    </span>
                  </span>
                </span>
                <ChevronRight className="event-chevron" size={17} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
