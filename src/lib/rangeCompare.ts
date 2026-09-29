/**
 * Сравнение двух точек графика — как в приложениях брокеров: провели по
 * графику, и видно, насколько изменилось значение между двумя датами.
 */

export interface RangeChange {
  from: { date: string; value: number };
  to: { date: string; value: number };
  /** Изменение в деньгах: конец минус начало. */
  delta: number;
  /**
   * Изменение в долях от начала. `null`, когда процент ничего не значит:
   * начало на нуле или в минусе — «рост на 300 %» от долга читался бы как
   * успех, хотя долг просто уменьшился.
   */
  pct: number | null;
  /** Сколько дней между точками. */
  days: number;
}

const DAY = 86_400_000;

/**
 * Изменение между датами `a` и `b` — в любом порядке: тянуть по графику можно
 * и справа налево. `null`, если какой-то даты на графике нет или она одна.
 */
export function rangeChange<T extends { date: string }>(
  points: readonly T[],
  a: string,
  b: string,
  valueOf: (p: T) => number
): RangeChange | null {
  if (a === b) return null;
  const [lo, hi] = a < b ? [a, b] : [b, a];
  const start = points.find((p) => p.date === lo);
  const end = points.find((p) => p.date === hi);
  if (!start || !end) return null;
  const from = { date: lo, value: valueOf(start) };
  const to = { date: hi, value: valueOf(end) };
  const delta = to.value - from.value;
  return {
    from,
    to,
    delta,
    pct: from.value > 0 ? delta / from.value : null,
    days: Math.round((Date.parse(hi) - Date.parse(lo)) / DAY),
  };
}
