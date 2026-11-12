'use client';
import { useEffect, useState } from 'react';

import type { SseState } from './useLiveAlerts';

const STATE_LABEL: Record<SseState, string> = {
  open: 'Онлайн',
  connecting: 'Переподключение…',
  closed: 'Нет связи',
};

export function LiveIndicator({ state, lastUpdateAt }: { state: SseState; lastUpdateAt: number | null }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const age = now !== null && lastUpdateAt !== null ? Math.max(0, Math.round((now - lastUpdateAt) / 1000)) : null;
  return (
    <span className="live" data-testid="sse-status" data-state={state}>
      <span className="live-dot" aria-hidden="true" />
      <span>
        {STATE_LABEL[state]}
        {age !== null && <span className="num"> · обновлено {age} с назад</span>}
      </span>
    </span>
  );
}
