// Explanation of one forecast cell: presence, level and the factors that move it most.
import { FACTOR_RU, LEVEL_RU, type CellFeature } from './schema';
import { formatContribution, formatNumber, formatPresence } from './format';

const TOP_FACTORS = 3;

/** The model reports SI units in English; show them in Russian. */
const UNIT_RU: Record<string, string> = {
  'm/s': 'м/с',
  m: 'м',
  km: 'км',
  C: '°C',
  'day of year': 'день года',
};

export function CellDetails({ cell }: { cell: CellFeature }) {
  const { id, presence, level, factors } = cell.properties;
  const top = [...factors]
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, TOP_FACTORS);

  return (
    <div className="text-sm leading-snug" aria-live="polite">
      <p className="text-xs text-[var(--muted)]">Ячейка №{id}</p>
      <p className="mt-1">
        Индекс присутствия: <strong className="tabular-nums">{formatPresence(presence)}</strong> из 1{' '}
        — {LEVEL_RU[level]} уровень
      </p>
      {top.length > 0 ? (
        <>
          <p className="mt-2 text-xs text-[var(--muted)]">Главные факторы (+ повышает, − понижает):</p>
          <ul className="mt-1 space-y-1">
            {top.map((factor) => {
              const sign = factor.contribution > 0 ? '+' : factor.contribution < 0 ? '−' : '0';
              const effect =
                factor.contribution > 0 ? 'повышает' : factor.contribution < 0 ? 'понижает' : 'не влияет';
              return (
                <li key={factor.name} className="flex gap-2">
                  <span
                    aria-hidden="true"
                    className={`w-4 shrink-0 text-center font-mono font-bold ${
                      factor.contribution > 0 ? 'text-[var(--accent)]' : 'text-[var(--info)]'
                    }`}
                  >
                    {sign}
                  </span>
                  <span>
                    {FACTOR_RU[factor.name] ?? factor.name}: {formatNumber(factor.value)}
                    {factor.unit ? `\u00a0${UNIT_RU[factor.unit] ?? factor.unit}` : ''} — {effect}{' '}
                    <span className="font-mono text-xs tabular-nums text-[var(--muted)]">
                      ({formatContribution(factor.contribution)})
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}
