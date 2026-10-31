import type { Transaction } from "../types";
import type { DigestEntry } from "./digest";
import { shiftDays } from "./period";

/**
 * Наблюдения «Дайджеста» — то, что в итогах и списках периода не видно, а
 * подмечать полезно: в какие дни недели уходят деньги, держат ли бюджет
 * несколько крупных покупок, дорожает ли средний чек, к какой половине
 * месяца расходы разгоняются.
 *
 * Раньше это были «Автонаблюдения» в «Cash-flow», но там половина повторяла
 * сам «Дайджест» (самая крупная трата, рост категории, норма сбережений,
 * расходы к прошлому месяцу) — здесь их нет, они уже есть на странице.
 *
 * Возвращаются числа, текст складывает страница: в нём суммы в валюте
 * пользователя.
 */
export type DigestObservation =
  /** Сколько стоит день выходных против дня будней. */
  | { id: "weekend"; ratio: number; weekendPerDay: number; weekdayPerDay: number }
  /** Самый дорогой день недели и во сколько раз он дороже среднего дня. */
  | {
      id: "weekday";
      weekday: number;
      perDay: number;
      ratio: number;
      /** Средний день по дням недели, 0 — воскресенье … 6 — суббота. */
      byWeekday: number[];
    }
  /** Какую долю расходов дали пять самых крупных покупок. */
  | { id: "concentration"; share: number; count: number; purchases: number }
  /** Средний чек и он же в прошлом таком же периоде. */
  | { id: "avgCheck"; avg: number; count: number; prevAvg: number | null }
  /** Расходы первой и второй половины месяца. */
  | { id: "halves"; first: number; second: number };

/** Меньше покупок — средний чек и «пять крупных» случайны. */
const MIN_PURCHASES = 8;
/** День недели — по месяцу, где каждый встретился хотя бы трижды. */
const MIN_DAYS_FOR_WEEKDAY = 21;

export function buildObservations(
  transactions: Transaction[],
  entry: Pick<DigestEntry, "period" | "start" | "end" | "days" | "running">
): DigestObservation[] {
  const out: DigestObservation[] = [];
  // У идущего месяца — только прожитые дни: будущие нулями сбили бы средние.
  const lived = entry.running ? entry.days.slice(0, entry.running.day) : entry.days;
  if (lived.length === 0) return out;
  const lastDay = lived[lived.length - 1].date;

  // ─── будни и выходные ───
  let we = 0;
  let weDays = 0;
  let wd = 0;
  let wdDays = 0;
  const byWeekday = Array.from({ length: 7 }, () => ({ sum: 0, days: 0 }));
  for (const d of lived) {
    const w = weekdayOf(d.date);
    byWeekday[w].sum += d.expense;
    byWeekday[w].days++;
    if (w === 0 || w === 6) {
      we += d.expense;
      weDays++;
    } else {
      wd += d.expense;
      wdDays++;
    }
  }
  const total = we + wd;
  if (weDays > 0 && wdDays > 0 && we > 0 && wd > 0) {
    const weekendPerDay = we / weDays;
    const weekdayPerDay = wd / wdDays;
    out.push({ id: "weekend", ratio: weekendPerDay / weekdayPerDay, weekendPerDay, weekdayPerDay });
  }

  // ─── самый дорогой день недели ───
  if (entry.period === "month" && lived.length >= MIN_DAYS_FOR_WEEKDAY && total > 0) {
    let best = -1;
    for (let w = 0; w < 7; w++) {
      const cur = byWeekday[w];
      if (!cur.days) continue;
      if (best < 0 || cur.sum / cur.days > byWeekday[best].sum / byWeekday[best].days) best = w;
    }
    const perDay = byWeekday[best].sum / byWeekday[best].days;
    const avg = total / lived.length;
    if (best >= 0 && perDay > 0)
      out.push({
        id: "weekday",
        weekday: best,
        perDay,
        ratio: perDay / avg,
        byWeekday: byWeekday.map((x) => (x.days ? x.sum / x.days : 0)),
      });
  }

  // ─── крупные покупки и средний чек ───
  const purchases = expensesIn(transactions, entry.start, lastDay);
  if (purchases.length >= MIN_PURCHASES) {
    const sorted = [...purchases].sort((a, b) => b - a);
    const sum = sorted.reduce((s, x) => s + x, 0);
    const top = sorted.slice(0, 5).reduce((s, x) => s + x, 0);
    if (sum > 0) out.push({ id: "concentration", share: top / sum, count: 5, purchases: purchases.length });

    // С чем сравнивать — столько же дней прямо перед периодом.
    const prevTo = shiftDays(entry.start, -1);
    const prevFrom = shiftDays(entry.start, -lived.length);
    const prev = expensesIn(transactions, prevFrom, prevTo);
    out.push({
      id: "avgCheck",
      avg: sum / purchases.length,
      count: purchases.length,
      prevAvg: prev.length >= MIN_PURCHASES ? prev.reduce((s, x) => s + x, 0) / prev.length : null,
    });
  }

  // ─── половины месяца ───
  // Только у завершённого месяца: у идущего вторая половина ещё не прожита.
  if (entry.period === "month" && !entry.running && entry.days.length >= 28) {
    const mid = Math.floor(entry.days.length / 2);
    const first = entry.days.slice(0, mid).reduce((s, d) => s + d.expense, 0);
    const second = entry.days.slice(mid).reduce((s, d) => s + d.expense, 0);
    if (first > 0 && second > 0) out.push({ id: "halves", first, second });
  }

  return out;
}

/** Суммы покупок (расходов, без возвратов) за отрезок, включительно. */
function expensesIn(transactions: Transaction[], from: string, to: string): number[] {
  const out: number[] = [];
  for (const t of transactions) {
    if (t.kind !== "expense") continue;
    const d = t.date.slice(0, 10);
    if (d >= from && d <= to && t.amountBase > 0) out.push(t.amountBase);
  }
  return out;
}

/** 0 — воскресенье … 6 — суббота, по календарной дате без часовых поясов. */
function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}
