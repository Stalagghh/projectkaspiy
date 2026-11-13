'use client';
import { useCallback, useEffect, useState } from 'react';

import { forecastApiResponseSchema, type ForecastApiResponse } from './schema';

export type PreviewDay = { date: string; mean: number | null; count: number };
type State = { status: 'loading' | 'empty' | 'error'; message?: string } | { status: 'ready'; data: ForecastApiResponse; days: PreviewDay[] };

function summarize(data: ForecastApiResponse): PreviewDay {
  const values = data.cells.features.map((cell) => cell.properties.presence);
  return { date: data.day, mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null, count: values.length };
}

/** The API exposes one day's cells. Never mix cells from different model runs. */
export function useForecastPreview() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => { setState({ status: 'loading' }); setRevision((value) => value + 1); }, []);
  useEffect(() => {
    const controller = new AbortController();
    const read = async (date?: string) => {
      const response = await fetch(`/api/forecast${date ? `?day=${date}` : ''}`, { cache: 'no-store', signal: controller.signal });
      const body: unknown = await response.json();
      if (response.status === 404 && (body as { error?: string }).error === 'no_forecast') return null;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return forecastApiResponseSchema.parse(body);
    };
    void (async () => {
      try {
        const first = await read();
        if (!first) { setState({ status: 'empty' }); return; }
        const days = await Promise.all(first.run.dates.map(async (date) => {
          if (date === first.day) return summarize(first);
          try {
            const result = await read(date);
            if (!result || result.run.id !== first.run.id) return { date, mean: null, count: 0 };
            return summarize(result);
          } catch { return { date, mean: null, count: 0 }; }
        }));
        if (!controller.signal.aborted) setState({ status: 'ready', data: first, days });
      } catch {
        if (!controller.signal.aborted) setState({ status: 'error', message: 'Не удалось загрузить прогноз' });
      }
    })();
    return () => controller.abort();
  }, [revision]);
  return { state, retry };
}
