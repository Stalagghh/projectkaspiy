'use client';
import { useNow } from '@/lib/useNow';

import type { SseState } from './useLiveAlerts';

const STATE_LABEL: Record<SseState, string> = {
  open: 'На связи',
  connecting: 'Переподключение…',
  closed: 'Нет связи',
};

/** Water stations report every 5 s; three missed reports in a row mean the picture is stale. */
const STALE_AFTER_S = 20;

export function LiveIndicator({ state, lastUpdateAt }: { state: SseState; lastUpdateAt: number | null }) {
  const now = useNow();
  const age = now !== null && lastUpdateAt !== null ? Math.max(0, Math.round((now - lastUpdateAt) / 1000)) : null;
  const stale = age !== null && age > STALE_AFTER_S;
  return (
    <span className="live" data-testid="sse-status" data-state={state} data-stale={stale}>
      <span className="live-dot" aria-hidden="true" />
      <span className="live-text">
        <span>{STATE_LABEL[state]}</span>
        {age !== null && (
          <span className="live-age num">{stale ? `данные устарели: ${age} с` : `обновлено ${age} с назад`}</span>
        )}
      </span>
    </span>
  );
}
