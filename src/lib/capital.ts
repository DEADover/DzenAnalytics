/**
 * Виджет «Капитал» на главной: как менялся совокупный баланс за период.
 *
 * Кривая — та же, что «Совокупный баланс» на «Счетах» (`useNetWorthSeries`):
 * счета «в балансе», каждый в своей валюте по курсу дня. Здесь только
 * арифметика над ней: срез периода, изменение, крайние точки и прореживание
 * для графика.
 */

export type CapitalPeriod = "3m" | "6m" | "1y" | "all";

export const CAPITAL_PERIODS: { id: CapitalPeriod; label: string; months: number | null }[] = [
  { id: "3m", label: "3 мес", months: 3 },
  { id: "6m", label: "Полгода", months: 6 },
  { id: "1y", label: "Год", months: 12 },
  { id: "all", label: "Всё время", months: null },
];

export interface CapitalPoint {
  date: string;
  net: number;
}

/** День, с которого начинается период: сегодня минус N месяцев. `null` — с начала истории. */
export function capitalPeriodStart(period: CapitalPeriod, today: string): string | null {
  const months = CAPITAL_PERIODS.find((p) => p.id === period)?.months ?? null;
  if (months == null) return null;
  const [y, m, d] = today.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1 - months, d));
  return start.toISOString().slice(0, 10);
}

/**
 * Точки периода. Первая — остаток на начало периода: последняя точка ДО
 * его первого дня, перенесённая на этот день, — иначе период, начавшийся в
 * день без операций, начинался бы с первой операции внутри и терял стартовый
 * уровень.
 */
export function capitalSlice(series: CapitalPoint[], from: string | null): CapitalPoint[] {
  if (!from) return series;
  const inside = series.filter((p) => p.date >= from);
  const before = series.filter((p) => p.date < from);
  const anchor = before.length ? before[before.length - 1] : null;
  if (anchor && (inside.length === 0 || inside[0].date > from)) {
    return [{ date: from, net: anchor.net }, ...inside];
  }
  return inside;
}

export interface CapitalSummary {
  current: number;
  start: number;
  delta: number;
  /** Изменение в процентах от стартового. `null`, когда старт не положителен — процент от нуля или долга ничего не значит. */
  pct: number | null;
  max: CapitalPoint;
  min: CapitalPoint;
  /** Средний прирост за месяц периода. `null` на отрезке короче месяца. */
  perMonth: number | null;
}

export function capitalSummary(points: CapitalPoint[]): CapitalSummary | null {
  if (points.length === 0) return null;
  const first = points[0];
  const last = points[points.length - 1];
  let max = first;
  let min = first;
  for (const p of points) {
    if (p.net > max.net) max = p;
    if (p.net < min.net) min = p;
  }
  const delta = last.net - first.net;
  const days = (Date.parse(last.date) - Date.parse(first.date)) / 86_400_000;
  const months = days / 30.44;
  return {
    current: last.net,
    start: first.net,
    delta,
    pct: first.net > 0 ? (delta / first.net) * 100 : null,
    max,
    min,
    perMonth: months >= 1 ? delta / months : null,
  };
}

/**
 * Прорядить кривую для графика: за несколько лет набегают тысячи дневных
 * точек, а на ширину карточки их нужно несколько сотен. Берём последнюю точку
 * каждого шага — значение на конец недели или месяца, — и всегда сохраняем
 * первую и последнюю, чтобы график начинался и кончался там же, где числа
 * рядом.
 */
export function thinCapital(points: CapitalPoint[], maxPoints = 400): CapitalPoint[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const out: CapitalPoint[] = [points[0]];
  for (let i = step; i < points.length - 1; i += step) out.push(points[i]);
  out.push(points[points.length - 1]);
  return out;
}
