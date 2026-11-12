// ru-RU formatting for the forecast screen. Dates of the run are calendar days (UTC);
// timestamps are shown in Moscow time.

const numberFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const contributionFormat = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: 'exceptZero',
});
const dayFormat = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'UTC',
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
});
const longDayFormat = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'UTC',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const moscowFormat = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const utcDay = (isoDate: string): Date => new Date(`${isoDate}T00:00:00Z`);

export const formatNumber = (value: number): string => numberFormat.format(value);

/** Contribution to the log-odds with an explicit sign, e.g. "+0,42" or "−0,15". */
export const formatContribution = (value: number): string =>
  contributionFormat.format(value).replace('-', '−');

export const formatPercent = (share: number): string => `${Math.round(share * 100)}\u00a0%`;

export const formatDayShort = (isoDate: string): string => dayFormat.format(utcDay(isoDate));

export const formatDayLong = (isoDate: string): string => longDayFormat.format(utcDay(isoDate));

export const formatMoscow = (timestamp: string): string =>
  `${moscowFormat.format(new Date(timestamp))} МСК`;

/** Freshness of a data source: a calendar date, or a timestamp in Moscow time. */
export function formatAsOf(asOf: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return dateFormat.format(utcDay(asOf));
  const time = Date.parse(asOf);
  return Number.isNaN(time) ? asOf : formatMoscow(asOf);
}
