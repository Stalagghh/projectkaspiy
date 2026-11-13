import { ArrowUpRight, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Panel, StatusBadge } from '@/components/Panel';
import { formatDayLong, formatWeekday } from '@/features/forecast/format';
import type { useForecastPreview } from '@/features/forecast/useForecastPreview';
import { useNow } from '@/lib/useNow';

export function ForecastSummary({ preview }: { preview: ReturnType<typeof useForecastPreview> }) {
  const [selected, setSelected] = useState(0);
  const now = useNow();
  const { state, retry } = preview;
  const stale = state.status === 'ready' && now !== null && now - Date.parse(state.data.run.issuedAt) > 12 * 60 * 60 * 1000;
  return (
    <Panel title="Прогноз: каспийский тюлень" id="forecast-preview-title" className="forecast-summary" action={<Link className="text-link" href={state.status === 'ready' ? `/forecast?day=${state.days[selected]?.date ?? state.data.day}` : '/forecast'}>Подробнее <ArrowUpRight size={16} aria-hidden="true" /></Link>}>
      {state.status === 'ready' ? <>
        <div className="forecast-mini">
          <div className="forecast-mini-value"><strong className="num">{state.days[selected]?.mean?.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? '—'}</strong><span>средний индекс<br />по ячейкам, 0–1</span>{stale && <StatusBadge tone="warning">Устарел</StatusBadge>}</div>
          <div className="mini-chart" role="group" aria-label="Средний индекс присутствия по дням, от 0 до 1">
            {state.days.map((day, index) => <button key={day.date} type="button" aria-pressed={selected === index} aria-label={`${formatDayLong(day.date)}: ${day.mean === null ? 'нет данных' : day.mean.toLocaleString('ru-RU', { maximumFractionDigits: 3 })}, среднее по ${day.count} ячейкам`} onClick={() => setSelected(index)} className="mini-day"><span className="mini-bar-track" aria-hidden="true"><span className="mini-bar" style={{ height: day.mean === null ? '0%' : `${day.mean * 100}%` }} /></span><span>{formatWeekday(day.date)}</span><small>{Number(day.date.slice(-2))}</small></button>)}
          </div>
        </div>
        <p className="caption">Упрощённая модель, не наблюдения. Есть синтетические входные данные.{state.days.some((day) => day.mean === null) ? ' Часть дней недоступна — повторите загрузку.' : ''}</p>
        {state.days.some((day) => day.mean === null) && <button className="text-link" type="button" onClick={retry}>Повторить загрузку</button>}
      </> : <div className="summary-empty" role="status" aria-busy={state.status === 'loading'}><span>{state.status === 'loading' ? 'Загружаем семь дней прогноза…' : state.status === 'empty' ? 'Прогноз ещё не рассчитан. Расчёт — каждые 6 часов.' : state.message}</span>{state.status !== 'loading' && <button type="button" className="text-link" onClick={retry}><RefreshCw size={15} aria-hidden="true" /> Проверить снова</button>}</div>}
    </Panel>
  );
}
