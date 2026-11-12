// Russian UI texts and formatters shared by client components. No server imports here.
import type { AlertDto, AlertKind, AlertStatus, PriorityReason, Severity } from '@ecoshield/contracts';

export const SEVERITY_LABEL: Record<Severity, string> = {
  info: 'Информация',
  warning: 'Предупреждение',
  critical: 'Критично',
};

export const KIND_LABEL: Record<AlertKind, string> = {
  gunshot: 'Выстрел',
  boat_in_no_entry_zone: 'Моторная лодка в зоне покоя',
  boat_detected: 'Моторная лодка',
  acoustic_unclassified: 'Акустическое событие без классификации',
};

export const STATUS_LABEL: Record<AlertStatus, string> = {
  new: 'Новая',
  acknowledged: 'Принята',
  assigned: 'Назначен патруль',
  resolved: 'Решена',
  false_positive: 'Ложное срабатывание',
};

export const AUDIO_LABEL: Record<string, string> = {
  boat_engine: 'Моторная лодка',
  gunshot: 'Выстрел',
  background: 'Фон (ничего значимого)',
};

export const QUALITATIVE_LABEL: Record<'high' | 'medium' | 'low', string> = {
  high: 'высокая уверенность',
  medium: 'средняя уверенность',
  low: 'низкая уверенность',
};

export const REASON_LABEL: Record<PriorityReason['code'], string> = {
  severity: 'серьёзность события',
  confidence: 'уверенность ИИ',
  no_entry_zone: 'в зоне покоя',
  correlated_gunshot: 'связана с тревогой о лодке',
  darkness: 'тёмное время суток',
};

export const METRIC_LABEL: Record<string, { label: string; unit: string; digits: number }> = {
  water_temp_c: { label: 'Температура воды', unit: '°C', digits: 1 },
  conductivity_us_cm: { label: 'Электропроводность', unit: 'мкСм/см', digits: 0 },
  turbidity_ntu: { label: 'Мутность', unit: 'NTU', digits: 1 },
};

const SEVERITY_RANK: Record<Severity, number> = { critical: 3, warning: 2, info: 1 };

/** Same order as GET /api/alerts: severity, then priority, then newest first. */
export function sortAlerts(alerts: AlertDto[]): AlertDto[] {
  return [...alerts].sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      b.priority - a.priority ||
      Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

const TZ = 'Europe/Moscow';
const timeFormat = new Intl.DateTimeFormat('ru-RU', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', {
  timeZone: TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const relativeFormat = new Intl.RelativeTimeFormat('ru-RU', { numeric: 'auto' });
const percentFormat = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 0 });

/** "16:20:11 МСК" */
export function formatTime(iso: string): string {
  return `${timeFormat.format(new Date(iso))} МСК`;
}

/** "12.11.2026, 16:20:11 МСК" */
export function formatDateTime(iso: string): string {
  return `${dateTimeFormat.format(new Date(iso))} МСК`;
}

export function formatRelative(iso: string, now: number): string {
  // Clamp small clock skew between browser and server: never show "in N seconds".
  const seconds = Math.min(0, Math.round((Date.parse(iso) - now) / 1000));
  const abs = Math.abs(seconds);
  if (abs < 10) return 'только что';
  if (abs < 60) return relativeFormat.format(seconds, 'second');
  if (abs < 3600) return relativeFormat.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return relativeFormat.format(Math.round(seconds / 3600), 'hour');
  return relativeFormat.format(Math.round(seconds / 86_400), 'day');
}

export function formatPercent(value: number): string {
  return percentFormat.format(value);
}

export function formatMetric(metric: string, value: number | null): string {
  const meta = METRIC_LABEL[metric];
  if (value === null) return `— ${meta?.unit ?? ''}`.trim();
  const number = new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: meta?.digits ?? 1,
    maximumFractionDigits: meta?.digits ?? 1,
  }).format(value);
  return `${number} ${meta?.unit ?? ''}`.trim();
}

export function formatCoord(lat: number, lon: number): string {
  return `${lat.toFixed(5)}° с. ш., ${lon.toFixed(5)}° в. д.`;
}

/** Plain Russian plural for seconds: 1 секунда, 2 секунды, 5 секунд. */
export function secondsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'секунду';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'секунды';
  return 'секунд';
}
