'use client';
import { Check, CircleCheck, X } from 'lucide-react';
import { useState, useTransition } from 'react';

import type { ActionResult, AlertDto } from '@ecoshield/contracts';

import { acknowledgeAlert, resolveAlert } from '@/features/alerts/server/actions';
import {
  AUDIO_LABEL,
  formatCoord,
  formatDateTime,
  formatPercent,
  KIND_LABEL,
  QUALITATIVE_LABEL,
  REASON_LABEL,
  secondsWord,
  STATUS_LABEL,
} from '@/lib/labels';

import { SeverityBadge } from './SeverityBadge';

const ERROR_TEXT: Record<'invalid' | 'not_found' | 'conflict' | 'forbidden', string> = {
  conflict: 'Тревогу уже изменил кто-то другой — показаны актуальные данные. Проверьте статус и повторите.',
  not_found: 'Тревога не найдена.',
  invalid: 'Некорректный запрос.',
  forbidden: 'Недостаточно прав.',
};

type Props = {
  alert: AlertDto;
  onClose: () => void;
  onUpdated: (alert: AlertDto) => void;
  onConflict: () => void;
};

export function AlertDetail({ alert, onClose, onUpdated, onConflict }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [spectrogramMissing, setSpectrogramMissing] = useState(false);

  const latencyS = Math.max(0, Math.round((Date.parse(alert.createdAt) - Date.parse(alert.eventAt)) / 1000));
  const canAcknowledge = alert.status === 'new';
  const canResolve = alert.status === 'new' || alert.status === 'acknowledged';

  function run(action: () => Promise<ActionResult<AlertDto>>) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.ok) {
          onUpdated(result.data);
          setNote('');
        } else {
          setError(ERROR_TEXT[result.error]);
          if (result.error === 'conflict') onConflict();
        }
      } catch {
        setError('Нет связи с сервером. Повторите.');
      }
    });
  }

  const detection = alert.detection;

  return (
    <section className="detail" data-testid="alert-detail" data-alert-id={alert.id} aria-labelledby="alert-detail-title">
      <div className="alert-row">
        <SeverityBadge severity={alert.severity} />
        <button type="button" className="btn" onClick={onClose} aria-label="Закрыть карточку тревоги">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        <h2 id="alert-detail-title">{KIND_LABEL[alert.kind]}</h2>
        <div className="alert-row" style={{ justifyContent: 'flex-start' }}>
          <span className="chip chip-status" data-testid="alert-status" data-status={alert.status}>
            {STATUS_LABEL[alert.status]}
          </span>
          {alert.isSimulated && <span className="chip chip-sim">СИМУЛЯЦИЯ</span>}
        </div>
      </div>

      <dl className="kv">
        <dt>Событие</dt>
        <dd className="num">{formatDateTime(alert.eventAt)}</dd>
        <dt>Тревога создана</dt>
        <dd className="num">{formatDateTime(alert.createdAt)}</dd>
        <dt>Задержка</dt>
        <dd>
          тревога через <span className="num">{latencyS}</span> {secondsWord(latencyS)} после события
        </dd>
        <dt>Устройство</dt>
        <dd>{alert.deviceName ?? '—'}</dd>
        <dt>Зона</dt>
        <dd>{alert.zoneName ?? 'вне режимных зон'}</dd>
        <dt>Координаты</dt>
        <dd className="mono">{alert.location ? formatCoord(alert.location.lat, alert.location.lon) : '—'}</dd>
      </dl>

      <div>
        <h3>
          Приоритет <span className="num">{alert.priority}</span>
        </h3>
        {alert.priorityReasons.length > 0 ? (
          <ul className="reasons">
            {alert.priorityReasons.map((reason) => (
              <li key={reason.code}>
                {REASON_LABEL[reason.code]}: <span className="num">+{reason.points}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="alert-meta">Причины не указаны.</p>
        )}
      </div>

      {alert.clipId && (
        <div style={{ display: 'grid', gap: 8 }}>
          <h3>Запись</h3>
          <audio
            controls
            preload="metadata"
            src={`/api/clips/${alert.clipId}/audio`}
            data-testid="alert-audio"
            style={{ width: '100%' }}
          >
            Ваш браузер не воспроизводит аудио.
          </audio>
          {/* eslint-disable-next-line @next/next/no-img-element -- PNG served by our API, not optimizable */}
          <img
            className="spectrogram"
            src={`/api/clips/${alert.clipId}/spectrogram`}
            alt="Спектрограмма записи (лог-мел)"
            data-testid="alert-spectrogram"
            hidden={spectrogramMissing}
            onError={() => setSpectrogramMissing(true)}
          />
          {spectrogramMissing && <p className="alert-meta">Спектрограмма недоступна.</p>}
        </div>
      )}

      {detection ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <h3>Распознавание</h3>
          <p style={{ margin: 0 }}>
            ИИ предполагает:{' '}
            <strong data-testid="alert-label" data-label={detection.label}>
              {AUDIO_LABEL[detection.label] ?? detection.label}
            </strong>{' '}
            (
            <span className="num" data-testid="alert-confidence" data-confidence={String(detection.confidence)}>
              {formatPercent(detection.confidence)}
            </span>
            , {QUALITATIVE_LABEL[detection.qualitative]})
          </p>
          <dl className="kv">
            <dt>Порог</dt>
            <dd>
              <span className="num">{formatPercent(detection.threshold)}</span> (предварительный порог)
            </dd>
            <dt>Модель</dt>
            <dd className="mono">
              {detection.modelName} {detection.modelVersion}
            </dd>
          </dl>
          <ul className="bars" data-testid="alert-topclasses" aria-label="Наиболее вероятные классы">
            {detection.topClasses.map((item) => (
              <li key={item.name} className="bar-row">
                <span title={item.name} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {AUDIO_LABEL[item.name] ?? item.name}
                </span>
                <span className="bar-track" aria-hidden="true">
                  <span className="bar-fill" style={{ display: 'block', width: `${Math.round(item.score * 100)}%` }} />
                </span>
                <span className="num">{formatPercent(item.score)}</span>
              </li>
            ))}
          </ul>
          <p className="ai-note" style={{ margin: 0 }}>
            ИИ предполагает, решение принимает инспектор.
          </p>
        </div>
      ) : (
        <p className="alert-meta">Распознавания нет: событие без классификации ИИ.</p>
      )}

      <div style={{ display: 'grid', gap: 8 }}>
        <h3>Действия</h3>
        <div className="actions">
          <button
            type="button"
            className="btn btn-brand"
            data-testid="action-acknowledge"
            disabled={!canAcknowledge || pending}
            onClick={() => run(() => acknowledgeAlert({ alertId: alert.id, version: alert.version }))}
          >
            <Check size={16} aria-hidden="true" />
            Принять
          </button>
          <button
            type="button"
            className="btn"
            data-testid="action-resolve"
            disabled={!canResolve || pending}
            onClick={() =>
              run(() =>
                resolveAlert({ alertId: alert.id, version: alert.version, note: note.trim() ? note.trim() : undefined }),
              )
            }
          >
            <CircleCheck size={16} aria-hidden="true" />
            Решено
          </button>
        </div>
        {canResolve && (
          <label style={{ display: 'grid', gap: 4, fontSize: 13.5 }}>
            Примечание к решению (необязательно, до 500 символов)
            <textarea
              className="note-input"
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
