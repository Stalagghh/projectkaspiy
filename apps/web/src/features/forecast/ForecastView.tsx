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
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

import {
  type ForecastApiResponse,
  forecastApiResponseSchema,
  type HydrologyDay,
  LEVEL_RU,
  PRESENCE_CLASSES,
  PRESENCE_RAMP,
} from './schema';
import { formatAsOf, formatDayLong, formatDayShort, formatMoscow, formatPercent } from './format';

const ForecastMap = dynamic(() => import('./ForecastMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
      Загрузка карты…
    </div>
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

  const load = useCallback(async (day?: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPendingDay(day ?? null);
    try {
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
      if (response.status === 404 && errorCode === 'day_out_of_range' && day) {
        // A newer run with other dates replaced the one on screen: show its first day.
        void load();
        return;
      }
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
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error('[forecast]', error);
      setState({ status: 'error', message: 'Нет связи с сервером.' });
    } finally {
      if (abortRef.current === controller) setPendingDay(null);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  if (state.status === 'loading') {
    return (
      <Shell>
        <div className="flex h-full min-h-[50vh] items-center justify-center gap-2 text-[var(--muted)]" role="status">
          <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
          Загрузка прогноза…
        </div>
      </Shell>
    );
  }

  if (state.status === 'empty') {
    return (
      <Shell>
        <div
          data-testid="forecast-empty"
          className="mx-auto mt-16 max-w-md rounded-lg border border-white/10 bg-[var(--surface)] p-6 text-center"
        >
          <Info className="mx-auto size-8 text-[var(--info)]" aria-hidden="true" />
          <h2 className="mt-3 text-lg font-semibold">Прогноз ещё не рассчитан</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Карта появится после первого расчёта модели присутствия тюленя. Расчёт запускается по
            расписанию раз в 6 часов.
          </p>
          <button
            type="button"
            onClick={() => {
              setState({ status: 'loading' });
              void load();
            }}
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-md border border-white/20 px-4 text-sm hover:bg-[var(--raised)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            <RotateCcw className="size-4" aria-hidden="true" /> Проверить снова
          </button>
        </div>
      </Shell>
    );
  }

  if (state.status === 'error') {
    return (
      <Shell>
        <div role="alert" className="mx-auto mt-16 max-w-md rounded-lg border border-[var(--critical)]/50 bg-[var(--surface)] p-6 text-center">
          <TriangleExclamationPoint className="mx-auto size-8 text-[var(--critical)]" aria-hidden="true" />
          <h2 className="mt-3 text-lg font-semibold">Не удалось загрузить прогноз</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">{state.message}</p>
          <button
            type="button"
            onClick={() => {
              setState({ status: 'loading' });
              void load();
            }}
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-md border border-white/20 px-4 text-sm hover:bg-[var(--raised)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            <RotateCcw className="size-4" aria-hidden="true" /> Повторить
          </button>
        </div>
      </Shell>
    );
  }

  const { data } = state;
  const { run, day } = data;
  const summary = run.summaries.find((item) => item.date === day);
  const hydrology = run.hydrology.find((item) => item.date === day);
  const stale = Date.now() - Date.parse(run.issuedAt) > STALE_AFTER_MS;
  const topCells = [...data.cells.features]
    .sort((a, b) => b.properties.presence - a.properties.presence)
    .slice(0, 5);

  return (
    <Shell>
      <div className="flex flex-col gap-3 lg:grid lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="relative h-[55vh] min-h-[320px] overflow-hidden rounded-lg border border-white/10 bg-[var(--surface)] lg:h-full">
          <ForecastMap cells={data.cells} selectedId={selectedId} onSelect={setSelectedId} />
          {pendingDay ? (
            <div role="status" className="absolute left-2 top-2 flex items-center gap-2 rounded bg-[var(--surface)]/90 px-2 py-1 text-xs">
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> Загрузка дня…
            </div>
          ) : null}
        </div>

        <aside className="flex flex-col gap-4 lg:min-h-0 lg:overflow-y-auto lg:pr-1" aria-label="Пояснение к прогнозу">
          <header>
            <h1 className="text-xl font-semibold">Прогноз присутствия каспийского тюленя</h1>
            <p className="mt-2 flex items-start gap-2 rounded-md border border-[var(--warning)]/60 bg-[var(--warning)]/10 px-3 py-2 text-sm">
              <FlaskConical className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" aria-hidden="true" />
              Упрощённая модель на допущениях — требует проверки экологами
            </p>
            {stale ? (
              <p className="mt-2 flex items-start gap-2 rounded-md border border-[var(--critical)]/60 px-3 py-2 text-sm">
                <TriangleExclamationPoint className="mt-0.5 size-4 shrink-0 text-[var(--critical)]" aria-hidden="true" />
                Данные устарели: прогноз рассчитан {formatMoscow(run.issuedAt)}.
              </p>
            ) : null}
          </header>

          <section aria-labelledby="forecast-days-title">
            <h2 id="forecast-days-title" className="text-sm font-medium text-[var(--muted)]">
              День прогноза
            </h2>
            <div role="group" aria-label="День прогноза" className="mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-7 lg:grid-cols-4">
              {run.dates.map((date, index) => {
                const pressed = date === (pendingDay ?? day);
                return (
                  <button
                    key={date}
                    type="button"
                    data-testid="forecast-day"
                    data-date={date}
                    aria-pressed={pressed}
                    aria-label={`День ${index + 1}: ${formatDayLong(date)}`}
                    onClick={() => {
                      if (date !== day || pendingDay) void load(date);
                    }}
                    className={`min-h-11 rounded-md border px-2 text-sm tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
                      pressed
                        ? 'border-[var(--brand)] bg-[var(--brand)] font-semibold text-[var(--bg)]'
                        : 'border-white/15 bg-[var(--surface)] hover:bg-[var(--raised)]'
                    }`}
                  >
                    {formatDayShort(date)}
                  </button>
                );
              })}
            </div>
          </section>

          <section data-testid="forecast-summary" aria-labelledby="forecast-summary-title" className="rounded-lg border border-white/10 bg-[var(--surface)] p-3">
            <h2 id="forecast-summary-title" className="text-sm font-medium text-[var(--muted)]">
              Пояснение на {formatDayLong(day)}
            </h2>
            <p className="mt-1 text-sm leading-relaxed">
              {summary?.summaryRu ?? 'Пояснение для этого дня не сохранено в прогоне.'}
            </p>
            {data.cells.features.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--warning)]">Для этого дня нет ячеек прогноза.</p>
            ) : null}
          </section>

          <Legend />

          {topCells.length > 0 ? (
            <section aria-labelledby="forecast-top-title">
              <h2 id="forecast-top-title" className="text-sm font-medium text-[var(--muted)]">
                Ячейки с наибольшей вероятностью
              </h2>
              <ol className="mt-2 space-y-1">
                {topCells.map((cell) => (
                  <li key={cell.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(cell.id)}
                      aria-pressed={selectedId === cell.id}
                      className={`flex min-h-11 w-full items-center justify-between rounded-md border px-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
                        selectedId === cell.id ? 'border-[var(--accent)]' : 'border-white/10 hover:bg-[var(--raised)]'
                      }`}
                    >
                      <span>Ячейка №{cell.id}</span>
                      <span className="font-mono tabular-nums">
                        {formatPercent(cell.properties.presence)} · {LEVEL_RU[cell.properties.level]}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          <section data-testid="forecast-sources" aria-labelledby="forecast-sources-title">
            <h2 id="forecast-sources-title" className="text-sm font-medium text-[var(--muted)]">
              Источники данных на этот день
            </h2>
            {hydrology ? (
              <SourceBadges hydrology={hydrology} />
            ) : (
              <p className="mt-1 text-sm text-[var(--warning)]">
                Источники входных данных для этого дня не указаны в прогоне.
              </p>
            )}
          </section>

          <section aria-labelledby="forecast-model-title" className="text-sm">
            <h2 id="forecast-model-title" className="text-sm font-medium text-[var(--muted)]">
              Модель
            </h2>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-[var(--muted)]">Название</dt>
              <dd>
                {run.modelName} <span className="font-mono">v{run.modelVersion}</span>
              </dd>
              <dt className="text-[var(--muted)]">Рассчитан</dt>
              <dd className="tabular-nums">{formatMoscow(run.issuedAt)}</dd>
              <dt className="text-[var(--muted)]">Допущения</dt>
              <dd className="font-mono text-xs leading-5">
                {run.assumptions.length > 0 ? run.assumptions.join(', ') : 'не указаны'}
              </dd>
            </dl>
            {data.warnings.length > 0 ? (
              <p className="mt-2 text-xs text-[var(--warning)]">
                Часть данных прогона в неожиданном формате и не показана: {data.warnings.join(', ')}.
              </p>
            ) : null}
          </section>

          <p className="text-xs leading-5 text-[var(--muted)]">
            Погода: Open-Meteo.com (CC BY 4.0) · SST: NOAA OISST v2.1 · Карта: © участники
            OpenStreetMap (ODbL), Protomaps
          </p>
        </aside>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="p-3 lg:h-[calc(100dvh-4rem)] lg:min-h-[560px]">{children}</div>;
}

function Legend() {
  const gradient = PRESENCE_RAMP.map(
    (stop) => `color-mix(in srgb, ${stop.color} ${Math.round(stop.opacity * 100)}%, var(--surface)) ${stop.at * 100}%`,
  ).join(', ');
  return (
    <section aria-labelledby="forecast-legend-title">
      <h2 id="forecast-legend-title" className="text-sm font-medium text-[var(--muted)]">
        Индекс присутствия (0–1)
      </h2>
      <div className="mt-2 h-3 rounded" style={{ background: `linear-gradient(to right, ${gradient})` }} aria-hidden="true" />
      <ul className="mt-2 grid grid-cols-3 gap-2 text-xs">
        {PRESENCE_CLASSES.map((item) => (
          <li key={item.level} className="flex flex-col">
            <span className="font-mono tabular-nums">
              {item.from.toLocaleString('ru-RU')}–{item.to.toLocaleString('ru-RU')}
            </span>
            <span>{item.labelRu}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-[var(--muted)]">Нажмите на ячейку, чтобы увидеть вероятность и факторы.</p>
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
    <ul className="mt-2 space-y-1.5">
      {SOURCE_ROWS.map(({ key, label, Icon, value }) => {
        const source = hydrology.sources[key];
        const real = source.kind === 'real';
        return (
          <li
            key={key}
            className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
              real ? 'border-[var(--brand)]/60' : 'border-[var(--warning)]/60'
            }`}
          >
            <Icon className="mt-0.5 size-4 shrink-0 text-[var(--muted)]" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="font-medium">{label}</span>
                <span className="font-mono text-xs tabular-nums">{value(hydrology)}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-[var(--muted)]">
                <span className={`inline-flex items-center gap-1 ${real ? 'text-[var(--brand)]' : 'text-[var(--warning)]'}`}>
                  {real ? <CircleCheck className="size-3.5" aria-hidden="true" /> : <FlaskConical className="size-3.5" aria-hidden="true" />}
                  {real ? 'реальные данные' : 'синтетика'}
                </span>
                <span>{source.name}</span>
                <span className="tabular-nums">на {formatAsOf(source.asOf)}</span>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
