'use client';
import { Check, CircleCheck, EarOff, LoaderCircle, X } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';

import type { ActionResult, AlertDto, AlertStatus } from '@ecoshield/contracts';

import { acknowledgeAlert, markFalsePositive, resolveAlert } from '@/features/alerts/server/actions';
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

/** The inspector's path through an alert. `assigned` and `false_positive` map onto the nearest step. */
const STEPS = ['Новая', 'Принята', 'Решена'] as const;
const STEP_OF: Record<AlertStatus, number> = {
  new: 0,
  acknowledged: 1,
  assigned: 1,
  resolved: 2,
  false_positive: 2,
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
  const titleRef = useRef<HTMLHeadingElement>(null);

  // The card opens next to the map: move focus into it and let Escape close it.
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const latencyS = Math.max(0, Math.round((Date.parse(alert.createdAt) - Date.parse(alert.eventAt)) / 1000));
  const canAcknowledge = alert.status === 'new';
  const canResolve = alert.status === 'new' || alert.status === 'acknowledged';
  const closed = alert.status === 'resolved' || alert.status === 'false_positive';
  const step = STEP_OF[alert.status];

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
  const place = [alert.deviceName, alert.zoneName ?? 'вне режимных зон'].filter(Boolean).join(' · ');

  return (
    <section
      className="detail"
      data-testid="alert-detail"
      data-alert-id={alert.id}
      data-severity={alert.severity}
      aria-labelledby="alert-detail-title"
    >
      <header className="detail-head">
        <div className="alert-row">
          <SeverityBadge severity={alert.severity} />
          <button type="button" className="btn btn-icon" onClick={onClose} aria-label="Закрыть карточку тревоги">
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <h2 id="alert-detail-title" ref={titleRef} tabIndex={-1}>
          {KIND_LABEL[alert.kind]}
        </h2>
        <p className="detail-place">{place}</p>
        <div className="alert-row" style={{ justifyContent: 'flex-start' }}>
          <span className="chip chip-status" data-testid="alert-status" data-status={alert.status}>
            {STATUS_LABEL[alert.status]}
          </span>
          {alert.isSimulated && <span className="chip chip-sim">симуляция</span>}
        </div>
      </header>

      <div className="detail-body">
        <ol className="steps" aria-label="Ход работы с тревогой">
          {STEPS.map((label, index) => {
            const state = index < step || (index === step && closed) ? 'done' : index === step ? 'current' : 'todo';
            return (
              <li key={label} data-state={state} aria-current={index === step ? 'step' : undefined}>
                <span className="step-dot" aria-hidden="true">
                  {state === 'done' && <Check size={13} strokeWidth={3} />}
                </span>
                {index === 2 && alert.status === 'false_positive' ? 'Ложная' : label}
              </li>
            );
          })}
        </ol>

        {detection ? (
          <section className="ai" aria-labelledby="alert-ai-title">
            <div className="ai-verdict">
              <div>
                <h3 className="eyebrow" id="alert-ai-title">
                  ИИ предполагает
                </h3>
                <strong className="ai-label" data-testid="alert-label" data-label={detection.label}>
                  {AUDIO_LABEL[detection.label] ?? detection.label}
                </strong>
              </div>
              <div className="ai-score num">
                <span data-testid="alert-confidence" data-confidence={String(detection.confidence)}>
                  {formatPercent(detection.confidence)}
                </span>
                <span className="ai-qual">{QUALITATIVE_LABEL[detection.qualitative]}</span>
              </div>
            </div>
            <div className="gauge" aria-hidden="true">
              <span className="gauge-fill" style={{ display: 'block', width: `${Math.round(detection.confidence * 100)}%` }} />
              <span className="gauge-tick" style={{ left: `${Math.round(detection.threshold * 100)}%` }} />
            </div>
            <p className="gauge-caption">
              Отметка на шкале — порог срабатывания <span className="num">{formatPercent(detection.threshold)}</span>{' '}
              (предварительный)
            </p>
            <p className="caption">Что слышит модель — классы AudioSet:</p>
            <ul className="bars" data-testid="alert-topclasses" aria-label="Наиболее вероятные классы звука">
              {detection.topClasses.map((item) => (
                <li key={item.name} className="bar-row">
                  <span className="bar-name" title={item.name}>
                    {AUDIO_LABEL[item.name] ?? item.name}
                  </span>
                  <span className="bar-track" aria-hidden="true">
                    <span className="bar-fill" style={{ width: `${Math.round(item.score * 100)}%` }} />
                  </span>
                  <span className="num">{formatPercent(item.score)}</span>
                </li>
              ))}
            </ul>
            <p className="ai-note">
              <strong>ИИ предполагает, решение принимает инспектор.</strong> Прослушайте запись перед решением.
            </p>
          </section>
        ) : (
          <p className="note">Распознавания нет: событие без классификации ИИ.</p>
        )}

        {alert.clipId && (
          <section className="detail-section" aria-labelledby="alert-clip-title">
            <h3 className="eyebrow" id="alert-clip-title">
              Запись с буя
            </h3>
            <audio
              className="player"
              controls
              preload="metadata"
              src={`/api/clips/${alert.clipId}/audio`}
              data-testid="alert-audio"
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
            <p className="caption">
              {spectrogramMissing
                ? 'Спектрограмма недоступна.'
                : 'Спектрограмма: время по горизонтали, частота по вертикали, яркость — громкость.'}
            </p>
          </section>
        )}

        <section className="detail-section" aria-labelledby="alert-facts-title">
          <h3 className="eyebrow" id="alert-facts-title">
            Событие
          </h3>
          <dl className="kv">
            <dt>Время события</dt>
            <dd className="num">{formatDateTime(alert.eventAt)}</dd>
            <dt>Тревога на экране</dt>
            <dd>
              через <span className="num">{latencyS}</span> {secondsWord(latencyS)} после события
            </dd>
            <dt>Устройство</dt>
            <dd>{alert.deviceName ?? '—'}</dd>
            <dt>Зона</dt>
            <dd>{alert.zoneName ?? 'вне режимных зон'}</dd>
            <dt>Координаты</dt>
            <dd className="mono">{alert.location ? formatCoord(alert.location.lat, alert.location.lon) : '—'}</dd>
            {detection && (
              <>
                <dt>Модель</dt>
                <dd className="mono">
                  {detection.modelName} {detection.modelVersion}
                </dd>
              </>
            )}
          </dl>
        </section>

        <section className="detail-section" aria-labelledby="alert-priority-title">
          <h3 className="eyebrow" id="alert-priority-title">
            Приоритет <span className="num priority-value">{alert.priority}</span>
          </h3>
          {alert.priorityReasons.length > 0 ? (
            <ul className="reasons">
              {alert.priorityReasons.map((reason) => (
                <li key={reason.code}>
                  {REASON_LABEL[reason.code]} <span className="num">+{reason.points}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="caption">Причины не указаны.</p>
          )}
        </section>

        {canResolve && (
          <label className="note-field">
            <span className="eyebrow">Примечание к решению</span>
            <textarea
              className="note-input"
              rows={2}
              maxLength={500}
              placeholder="Необязательно, до 500 символов. Сохранится вместе с решением."
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
        )}
      </div>

      <footer className="detail-actions">
        {closed && (
          <p className="done-line" data-status={alert.status}>
            {alert.status === 'resolved' ? <CircleCheck size={18} aria-hidden="true" /> : <EarOff size={18} aria-hidden="true" />}
            {alert.status === 'resolved' ? 'Тревога отработана и закрыта.' : 'Инспектор отметил ложное срабатывание модели.'}
          </p>
        )}
        <div className="actions" hidden={closed}>
          <button
            type="button"
            className="btn btn-brand btn-block"
            data-testid="action-acknowledge"
            disabled={!canAcknowledge || pending}
            onClick={() => run(() => acknowledgeAlert({ alertId: alert.id, version: alert.version }))}
          >
            {pending && canAcknowledge ? (
              <LoaderCircle size={16} className="spin" aria-hidden="true" />
            ) : (
              <Check size={16} aria-hidden="true" />
            )}
            Принять
          </button>
          <button
            type="button"
            className="btn btn-block"
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
          <button
            type="button"
            className="btn btn-quiet"
            data-testid="action-false-positive"
            disabled={pending}
            onClick={() =>
              run(() =>
                markFalsePositive({ alertId: alert.id, version: alert.version, note: note.trim() ? note.trim() : undefined }),
              )
            }
          >
            <EarOff size={16} aria-hidden="true" />
            Ложное срабатывание — на записи другое
          </button>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </footer>
    </section>
  );
}
