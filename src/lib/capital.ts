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
 * Остатки за отрезок дат — с переносом остатка через дни без операций.
 *
 * Остаток не пропадает оттого, что в периоде не было операций: в октябре без
 * единой траты баланс — это остаток на конец сентября. Поэтому:
 *
 *   • первая точка — остаток на первый день отрезка: последняя точка ДО него,
 *     перенесённая на этот день (если в сам день операции не было);
 *   • последняя — тот же остаток на конец отрезка, но не позже сегодня:
 *     будущего остатка мы не знаем, а линия должна доходить до «сейчас»;
 *   • пусто — только если весь отрезок лежит раньше начала истории.
 *
 * Раньше период без операций давал пустой график и прочерки в «Совокупном
 * балансе» и «Наибольшем балансе», хотя деньги на счетах были (01.10.2026).
 *
 * Точка переносится целиком (`{ ...p, date }`) — так переносятся и остатки
 * отдельных счетов у графика «По счетам».
 */
export function clipBalances<T extends { date: string }>(
  series: T[],
  from: string | null,
  to: string | null,
  today: string
): T[] {
  const lo = from ?? "";
  const hi = to ?? "9999-12-31";
  const out = series.filter((p) => p.date >= lo && p.date <= hi);
  if (from) {
    let before: T | undefined;
    for (const p of series) {
      if (p.date < from) before = p;
      else break;
    }
    if (before && (out.length === 0 || out[0].date > from)) {
      out.unshift({ ...before, date: from });
    }
  }
  if (out.length === 0) return out;
  const end = hi < today ? hi : today;
  const last = out[out.length - 1];
  if (last.date < end) out.push({ ...last, date: end });
  return out;
}

/** Точки периода виджета «Капитал» — см. `clipBalances`; конец — сегодня. */
export function capitalSlice(
  series: CapitalPoint[],
  from: string | null,
  today?: string
): CapitalPoint[] {
  if (!from && !today) return series;
  // Без «сегодня» линию до конца не дотягиваем — кончается последней точкой.
  const end = today ?? series[series.length - 1]?.date ?? "";
  return clipBalances(series, from, null, end);
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
