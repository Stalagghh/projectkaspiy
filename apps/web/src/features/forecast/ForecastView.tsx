'use client';
// /forecast screen: map of the seal presence index plus a side panel with the day selector,
// plain-language explanation, legend, data sources and model details.
import {
  CircleCheck,
  FlaskConical,
  Info,
  LoaderCircle,
  RotateCcw,
  Thermometer,
  TriangleExclamationPoint,
  WavesHorizontal,
  Wind,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';

import { useNow } from '@/lib/useNow';

import {
  type ForecastApiResponse,
  forecastApiResponseSchema,
  type HydrologyDay,
  LEVEL_RU,
  PRESENCE_CLASSES,
  PRESENCE_RAMP,
} from './schema';
import { formatAsOf, formatDayLong, formatDayMonth, formatMoscow, formatPresence, formatWeekday } from './format';

const ForecastMap = dynamic(() => import('./ForecastMap'), {
  ssr: false,
  loading: () => (
    <p className="status-line" style={{ height: '100%', justifyContent: 'center', color: 'var(--muted)' }}>Загрузка карты…</p>
  ),
});

/** A run older than this is flagged as stale (the job runs every 6 hours). */
const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

type State =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: ForecastApiResponse };

export function ForecastView() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [pendingDay, setPendingDay] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const now = useNow();

  const load = useCallback(async (requestedDay?: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      // If a newer run with other dates replaced the one on screen, the second attempt shows its first day.
      for (const day of requestedDay ? [requestedDay, undefined] : [undefined]) {
        const query = day ? `?day=${encodeURIComponent(day)}` : '';
        const response = await fetch(`/api/forecast${query}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const body: unknown = await response.json().catch(() => null);
        const errorCode = (body as { error?: string } | null)?.error;
        if (response.status === 404 && errorCode === 'no_forecast') {
          setState({ status: 'empty' });
          return;
        }
        if (response.status === 404 && errorCode === 'day_out_of_range' && day) continue;
        if (!response.ok) {
          setState({ status: 'error', message: `Сервер ответил ошибкой ${response.status}.` });
          return;
        }
        const parsed = forecastApiResponseSchema.safeParse(body);
        if (!parsed.success) {
          setState({ status: 'error', message: 'Данные прогноза пришли в неожиданном формате.' });
          return;
        }
        setState({ status: 'ready', data: parsed.data });
        return;
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error('[forecast]', error);
      setState({ status: 'error', message: 'Нет связи с сервером.' });
    } finally {
      if (abortRef.current === controller) setPendingDay(null);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() sets state only after its fetch settles
    void load(new URLSearchParams(window.location.search).get('day') ?? undefined);
    return () => abortRef.current?.abort();
  }, [load]);

  if (state.status === 'loading') {
    return (
      <main className="center-state">
        <p className="status-line" role="status" style={{ color: 'var(--muted)' }}>
          <LoaderCircle size={20} className="spin" aria-hidden="true" />
          Загрузка прогноза…
        </p>
      </main>
    );
  }

  if (state.status === 'empty') {
    return (
      <main className="center-state">
        <div className="center-card" data-testid="forecast-empty">
          <Info size={30} style={{ color: 'var(--info)' }} aria-hidden="true" />
          <h2>Прогноз ещё не рассчитан</h2>
          <p>
            Карта появится после первого расчёта модели присутствия тюленя. Расчёт запускается по расписанию раз в
            6 часов.
          </p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setState({ status: 'loading' });
              void load();
            }}
          >
            <RotateCcw size={16} aria-hidden="true" /> Проверить снова
          </button>
        </div>
      </main>
    );
  }

  if (state.status === 'error') {
    return (
      <main className="center-state">
        <div className="center-card" role="alert">
          <TriangleExclamationPoint size={30} style={{ color: 'var(--critical)' }} aria-hidden="true" />
          <h2>Не удалось загрузить прогноз</h2>
          <p>{state.message}</p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setState({ status: 'loading' });
              void load();
            }}
          >
            <RotateCcw size={16} aria-hidden="true" /> Повторить
          </button>
        </div>
      </main>
    );
  }

  const { data } = state;
  const { run, day } = data;
  const summary = run.summaries.find((item) => item.date === day);
  const hydrology = run.hydrology.find((item) => item.date === day);
  const stale = now !== null && now - Date.parse(run.issuedAt) > STALE_AFTER_MS;
  const topCells = [...data.cells.features]
    .sort((a, b) => b.properties.presence - a.properties.presence)
    .slice(0, 5);

  return (
    <main className="forecast-page">
      <header><h1 className="page-title">Прогноз: каспийский тюлень</h1><p className="page-lead">Семь дней · индекс присутствия по ячейкам акватории · шкала 0–1</p></header>
      <div className="forecast-layout">
      <div className="map-col">
        <div className="map-stage">
          <ForecastMap cells={data.cells} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
        <div className="map-top">
          <span className="chip chip-sim map-sim">
            <FlaskConical size={14} aria-hidden="true" />
            Упрощённая модель — не наблюдения
          </span>
          {pendingDay ? (
            <span className="chip map-sim" role="status">
              <LoaderCircle size={14} className="spin" aria-hidden="true" /> Загрузка дня…
            </span>
          ) : null}
        </div>
        <Legend />
      </div>

      <aside className="panel" aria-label="Пояснение к прогнозу">
        <div className="panel-scroll">
          <header className="section">
            <div>
              <h2 className="side-title">Модель и условия</h2>
              <p className="page-lead">Прогноз не является вероятностью встречи или наблюдаемой численностью.</p>
            </div>
            <p className="note note-sim">
              <FlaskConical size={16} aria-hidden="true" />
              Упрощённая модель на допущениях — требует проверки экологами
            </p>
            {stale ? (
              <p className="note note-critical">
                <TriangleExclamationPoint size={16} aria-hidden="true" />
                Данные устарели: прогноз рассчитан {formatMoscow(run.issuedAt)}.
              </p>
            ) : null}
          </header>

          <section className="section" aria-labelledby="forecast-days-title">
            <h2 id="forecast-days-title" className="eyebrow">
              День прогноза
            </h2>
            <div role="group" aria-label="День прогноза" className="days">
              {run.dates.map((date, index) => {
                const pressed = date === (pendingDay ?? day);
                return (
                  <button
                    key={date}
                    type="button"
                    className="day"
                    data-testid="forecast-day"
                    data-date={date}
                    aria-pressed={pressed}
                    aria-label={`День ${index + 1}: ${formatDayLong(date)}`}
                    onClick={() => {
                      if (date !== day || pendingDay) {
                        setPendingDay(date);
                        void load(date);
                      }
                    }}
                  >
                    <span className="day-week">{formatWeekday(date)}</span>
                    <span className="day-date num">{formatDayMonth(date)}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="section" data-testid="forecast-summary" aria-labelledby="forecast-summary-title">
            <h2 id="forecast-summary-title" className="eyebrow">
              Пояснение на {formatDayLong(day)}
            </h2>
            <p className="section-text">{summary?.summaryRu ?? 'Пояснение для этого дня не сохранено в прогоне.'}</p>
            {data.cells.features.length === 0 ? (
              <p className="note note-warning">
                <TriangleExclamationPoint size={16} aria-hidden="true" />
                Для этого дня нет ячеек прогноза.
              </p>
            ) : null}
          </section>

          <section className="section" data-testid="forecast-sources" aria-labelledby="forecast-sources-title">
            <h2 id="forecast-sources-title" className="eyebrow">
              Условия в этот день и их источники
            </h2>
            {hydrology ? (
              <SourceBadges hydrology={hydrology} />
            ) : (
              <p className="note note-warning">
                <TriangleExclamationPoint size={16} aria-hidden="true" />
                Источники входных данных для этого дня не указаны в прогоне.
              </p>
            )}
          </section>

          {topCells.length > 0 ? (
            <section className="section" aria-labelledby="forecast-top-title">
              <h2 id="forecast-top-title" className="eyebrow">
                Где индекс выше всего
              </h2>
              <ol className="rank">
                {topCells.map((cell) => (
                  <li key={cell.id}>
                    <button
                      type="button"
                      className="rank-item"
                      style={{ '--share': `${Math.round(cell.properties.presence * 100)}%` } as CSSProperties}
                      onClick={() => setSelectedId(cell.id)}
                      aria-pressed={selectedId === cell.id}
                    >
                      <span>Ячейка №{cell.id}</span>
                      <span className="num">
                        {formatPresence(cell.properties.presence)} · {LEVEL_RU[cell.properties.level]}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              <p className="caption">Нажмите на строку или на ячейку карты — покажем, какие факторы дали такой индекс.</p>
            </section>
          ) : null}

          <section className="section" aria-labelledby="forecast-model-title">
            <h2 id="forecast-model-title" className="eyebrow">
              Модель
            </h2>
            <dl className="kv">
              <dt>Название</dt>
              <dd>
                {run.modelName} <span className="mono">v{run.modelVersion}</span>
              </dd>
              <dt>Рассчитан</dt>
              <dd className="num">{formatMoscow(run.issuedAt)}</dd>
              <dt>Допущения</dt>
              <dd className="mono" style={{ fontSize: 12, lineHeight: 1.6 }}>
                {run.assumptions.length > 0 ? run.assumptions.join(', ') : 'не указаны'}
              </dd>
            </dl>
            {data.warnings.length > 0 ? (
              <p className="note note-warning">
                <TriangleExclamationPoint size={16} aria-hidden="true" />
                Часть данных прогона в неожиданном формате и не показана: {data.warnings.join(', ')}.
              </p>
            ) : null}
          </section>

          <p className="footnote">
            Погода: Open-Meteo.com (CC BY 4.0) · Температура воды: NOAA OISST v2.1 · Карта: © участники OpenStreetMap
            (ODbL), Protomaps
          </p>
        </div>
      </aside>
      </div>
    </main>
  );
}

function Legend() {
  const gradient = PRESENCE_RAMP.map(
    (stop) => `color-mix(in srgb, ${stop.color} ${Math.round(stop.opacity * 100)}%, var(--surface)) ${stop.at * 100}%`,
  ).join(', ');
  return (
    <section className="map-panel map-legend-box" aria-labelledby="forecast-legend-title">
      <h2 id="forecast-legend-title" className="eyebrow">
        Индекс присутствия, 0–1
      </h2>
      <div className="ramp" style={{ background: `linear-gradient(to right, ${gradient})` }} aria-hidden="true" />
      <ul className="ramp-scale">
        {PRESENCE_CLASSES.map((item) => (
          <li key={item.level}>
            <span className="num">
              {item.from.toLocaleString('ru-RU')}–{item.to.toLocaleString('ru-RU')}
            </span>
            <span>{item.labelRu}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const SOURCE_ROWS = [
  { key: 'wind', label: 'Ветер', Icon: Wind, value: (h: HydrologyDay) => `${h.windSpeedMs.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} м/с` },
  { key: 'waves', label: 'Волнение', Icon: WavesHorizontal, value: (h: HydrologyDay) => `${h.waveHeightM.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} м` },
  { key: 'sst', label: 'Температура воды', Icon: Thermometer, value: (h: HydrologyDay) => `${h.sstC.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} °C` },
] as const;

function SourceBadges({ hydrology }: { hydrology: HydrologyDay }) {
  return (
    <ul className="sources">
      {SOURCE_ROWS.map(({ key, label, Icon, value }) => {
        const source = hydrology.sources[key];
        const real = source.kind === 'real';
        return (
          <li key={key} className="source" data-kind={real ? 'real' : 'synthetic'}>
            <Icon size={17} aria-hidden="true" />
            <span>{label}</span>
            <span className="source-value num">{value(hydrology)}</span>
            <span className="source-meta">
              <span className="source-kind">
                {real ? <CircleCheck size={13} aria-hidden="true" /> : <FlaskConical size={13} aria-hidden="true" />}
                {real ? 'реальные данные' : 'синтетика'}
              </span>
              <span>{source.name}</span>
              <span className="num">на {formatAsOf(source.asOf)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
