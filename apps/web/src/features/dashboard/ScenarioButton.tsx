'use client';
import { Play } from 'lucide-react';
import { useState } from 'react';

import { scenarioRunSchema, type ScenarioRun } from '@ecoshield/contracts';

import { formatTime } from '@/lib/labels';

const STEP_LABEL: Record<string, string> = { 'boat-engine': 'лодка', gunshot: 'выстрел' };

type State =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'started'; run: ScenarioRun }
  | { kind: 'error'; message: string };

export function ScenarioButton() {
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function start() {
    setState({ kind: 'starting' });
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
  }

  return (
    <div className="scenario">
      <button
        type="button"
        className="btn btn-primary"
        data-testid="start-scenario"
        onClick={() => void start()}
        disabled={state.kind === 'starting'}
      >
        <Play size={16} aria-hidden="true" />
        Запустить сценарий «Ночной браконьер»
      </button>
      <span className="scenario-status" role="status" data-tone={state.kind === 'error' ? 'error' : undefined}>
        {state.kind === 'starting' && 'Запуск…'}
        {state.kind === 'error' && `Не удалось запустить: ${state.message}`}
        {state.kind === 'started' &&
          `Сценарий запущен в ${formatTime(state.run.startedAt)}: ${state.run.steps
            .map((step) => `${STEP_LABEL[step.step] ?? step.step} через ${step.offsetS} с`)
            .join(', ')}`}
      </span>
    </div>
  );
}
