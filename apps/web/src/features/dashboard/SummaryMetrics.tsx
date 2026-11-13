import { Activity, CircleHelp, Radio, ShieldAlert, Waves } from 'lucide-react';
import type { ReactNode } from 'react';

import { StatusBadge } from '@/components/Panel';
import type { MapDevice } from '@/features/map/geo-types';
import { formatPercent } from '@/lib/labels';
import { useNow } from '@/lib/useNow';

function Metric({ Icon, value, label, children, indicator }: { Icon: typeof Radio; value: ReactNode; label: string; children: ReactNode; indicator?: ReactNode }) {
  return <section className="metric"><Icon className="metric-icon" size={29} strokeWidth={1.6} aria-hidden="true" /><div className="metric-content"><strong className="metric-value num">{value}</strong><h2>{label}</h2><div className="metric-support">{children}</div></div>{indicator}</section>;
}

export function SummaryMetrics({ devices, deviceStatus, activeCount, alertsReady, presence }: { devices: MapDevice[]; deviceStatus: string; activeCount: number; alertsReady: boolean; presence: number | null }) {
  const now = useNow();
  // Device contract has timestamps, not an authoritative offline state. A missing report is unknown.
  const online = now === null ? 0 : devices.filter((device) => device.lastSeenAt && now - Date.parse(device.lastSeenAt) <= 20_000).length;
  const available = deviceStatus === 'ready' && now !== null && devices.length > 0;
  const ratio = available ? online / devices.length : null;
  return (
    <div className="summary-metrics" aria-label="Сводка по территории">
      <Metric Icon={Radio} value={available ? <>{online}<span className="metric-denominator">/{devices.length}</span></> : '—'} label="Датчики на связи" indicator={<div className="availability-ring" role="img" aria-label={ratio === null ? 'Доступность неизвестна' : `Свежая телеметрия: ${formatPercent(ratio)}`} style={{ background: ratio === null ? 'var(--line)' : `conic-gradient(var(--healthy) ${ratio * 360}deg, var(--line) 0)` }}><span>{ratio === null ? '—' : formatPercent(ratio)}</span></div>}>
        {available ? `${devices.length - online} без свежих данных` : deviceStatus === 'error' ? 'Телеметрия недоступна' : 'Ожидаем телеметрию'}
      </Metric>
      <Metric Icon={Activity} value={alertsReady ? activeCount : '—'} label="Активные события"><span className="metric-dot" />{alertsReady ? 'В текущей ленте' : 'Ожидаем события'}</Metric>
      <Metric Icon={ShieldAlert} value="—" label="Индекс риска"><StatusBadge><CircleHelp size={12} aria-hidden="true" /> Не рассчитывается</StatusBadge></Metric>
      <Metric Icon={Waves} value={presence === null ? '—' : presence.toLocaleString('ru-RU', { maximumFractionDigits: 2, minimumFractionDigits: 2 })} label="Индекс присутствия тюленя"><StatusBadge tone="healthy">Модель · шкала 0–1</StatusBadge></Metric>
    </div>
  );
}
