'use client';
// The demo scenario: one hook that owns the run, a button for the top bar and a progress note
// that sits above the alert feed, where the alerts are about to appear.
import { Check, LoaderCircle, Play, Radio, TriangleExclamationPoint } from 'lucide-react';
import { useCallback, useState } from 'react';

import { scenarioRunSchema, type ScenarioRun } from '@ecoshield/contracts';

import { useNow } from '@/lib/useNow';

const STEP_LABEL: Record<string, string> = {
  'boat-engine': 'Буй передаёт звук мотора',
  gunshot: 'Буй передаёт звук выстрела',
};
/** The progress note disappears this long after the last scripted event. */
const HIDE_AFTER_LAST_STEP_S = 6;

type State =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'started'; run: ScenarioRun }
  | { kind: 'error'; message: string };

export type Scenario = {
  state: State;
  /** Seconds since the simulator started the run (0 when nothing runs). */
  elapsedS: number;
  /** True from the start until a few seconds after the last scripted event. */
  running: boolean;
  start: () => void;
};

export function useScenario(): Scenario {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const now = useNow();

  const start = useCallback(() => {
    setState({ kind: 'starting' });
    void (async () => {
      try {
        const response = await fetch('/api/demo/start', { method: 'POST' });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const message =
            body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
              ? body.message
              : `Ошибка ${response.status}`;
          setState({ kind: 'error', message });
          return;
        }
        const run = scenarioRunSchema.safeParse(body);
        setState(run.success ? { kind: 'started', run: run.data } : { kind: 'error', message: 'Неожиданный ответ' });
      } catch {
        setState({ kind: 'error', message: 'Нет связи с сервером' });
      }
    })();
  }, []);

  // Countdown to each scripted event, from the start time the simulator reported.
  const elapsedS = state.kind === 'started' && now !== null ? Math.max(0, (now - Date.parse(state.run.startedAt)) / 1000) : 0;
  const lastOffsetS = state.kind === 'started' ? Math.max(0, ...state.run.steps.map((step) => step.offsetS)) : 0;
  const running = state.kind === 'started' && elapsedS < lastOffsetS + HIDE_AFTER_LAST_STEP_S;
  return { state, elapsedS, running, start };
}

export function ScenarioButton({ scenario }: { scenario: Scenario }) {
  const starting = scenario.state.kind === 'starting';
  return (
    <button
      type="button"
      className="btn btn-primary"
      data-testid="start-scenario"
      aria-label="Запустить сценарий «Ночной браконьер»"
      onClick={scenario.start}
      disabled={starting || scenario.running}
    >
      {starting ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
      <span className="btn-label-long">Сценарий «Ночной браконьер»</span>
      <span className="btn-label-short">Сценарий</span>
    </button>
  );
}

export function ScenarioProgress({ scenario }: { scenario: Scenario }) {
  const { state, elapsedS, running } = scenario;
  return (
    <div role="status">
      {state.kind === 'error' && (
        <p className="scenario-note" data-tone="error">
          <TriangleExclamationPoint size={16} aria-hidden="true" />
          Не удалось запустить сценарий: {state.message}
        </p>
      )}
      {running && state.kind === 'started' && (
        <div className="scenario-note">
          <p>
            <strong>Сценарий идёт.</strong> Звуки отправляет симулятор буя, распознаёт настоящая модель.
          </p>
          <ol className="scenario-steps">
            {state.run.steps.map((step) => {
              const left = Math.ceil(step.offsetS - elapsedS);
              const done = left <= 0;
              return (
                <li key={step.step} data-done={done}>
                  {done ? <Check size={16} aria-hidden="true" /> : <Radio size={16} aria-hidden="true" />}
                  <span>{STEP_LABEL[step.step] ?? step.step}</span>
                  <span className="num">{done ? 'отправлено' : `через ${left} с`}</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
