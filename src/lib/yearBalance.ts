/**
 * Баланс за год: на начало, на конец, наибольший и наименьший (#132).
 *
 * Считается по ряду «совокупный баланс по дням» — точка есть только в день,
 * когда баланс менялся, между точками он держится прежним.
 */

export interface BalancePoint {
  date: string;
  net: number;
}

export interface BalanceMark {
  date: string;
  value: number;
}

export interface YearBalance {
  /** Баланс к началу года. История началась позже — первая её точка. */
  start: BalanceMark & { fromHistoryStart: boolean };
  /** Баланс на конец года, у идущего года — на сегодня. */
  end: BalanceMark;
  max: BalanceMark;
  min: BalanceMark;
}

/**
 * `from`–`to` — границы года, `today` — сегодня: будущего у идущего года нет.
 * `null` — в ряду нет ни одной точки до конца года.
 */
export function yearBalance(
  series: readonly BalancePoint[],
  from: string,
  to: string,
  today: string
): YearBalance | null {
  const limit = to < today ? to : today;
  if (limit < from) return null;
  let before: BalancePoint | null = null;
  const inside: BalancePoint[] = [];
  for (const p of series) {
    const d = p.date.slice(0, 10);
    if (d < from) before = p;
    else if (d <= limit) inside.push(p);
  }
  if (!before && inside.length === 0) return null;

  const start = before
    ? { date: from, value: before.net, fromHistoryStart: false }
    : { date: inside[0].date.slice(0, 10), value: inside[0].net, fromHistoryStart: true };
  const last = inside.length > 0 ? inside[inside.length - 1] : before!;

  let max: BalanceMark = { date: start.date, value: start.value };
  let min: BalanceMark = { date: start.date, value: start.value };
  for (const p of inside) {
    if (p.net > max.value) max = { date: p.date.slice(0, 10), value: p.net };
    if (p.net < min.value) min = { date: p.date.slice(0, 10), value: p.net };
  }
  return { start, end: { date: limit, value: last.net }, max, min };
}
