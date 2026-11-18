/**
 * «Категория под наблюдением» — одна статья расходов: сколько ушло в этом
 * месяце, сколько обычно уходит к этому дню и как было в прошлые месяцы.
 *
 * Правила те же, что у «Темпа трат»: возврат уменьшает расход, идущий месяц
 * сравнивается с такими же началами прошлых, в среднее идут только полные
 * месяцы истории.
 */

import type { Transaction } from "../types";
import { endAfterDays, periodKey, periodRange, shiftPeriod, spanDays } from "./period";

export interface WatchBar {
  ym: string;
  /** Расход статьи за месяц; у идущего — к сегодняшнему дню. */
  total: number;
  /** Это месяц виджета. */
  current: boolean;
}

export interface CategoryWatch {
  /** Потрачено с начала месяца. */
  nowAt: number;
  /** Сколько операций сложилось в это число. */
  count: number;
  /** В среднем к этому дню за прошлые месяцы; null — сравнивать не с чем. */
  avgAt: number | null;
  /** Сколько месяцев вошло в среднее. */
  avgMonths: number;
  /** Месяц ещё идёт. */
  running: boolean;
  /** Последние месяцы, старый → новый; последний — месяц виджета. */
  bars: WatchBar[];
}

/** Сколько месяцев на столбиках и сколько из них идёт в среднее. */
export const WATCH_BARS = 6;
export const WATCH_AVG_MONTHS = 3;

/** Относится ли операция к статье: категория целиком или одна её подкатегория. */
export function inWatched(t: Transaction, category: string, subcategory: string | null): boolean {
  if (t.category !== category) return false;
  return subcategory === null || t.subcategory === subcategory;
}

const amountOf = (t: Transaction) =>
  t.kind === "expense" ? t.amountBase : t.kind === "refund" ? -t.amountBase : 0;

export function buildCategoryWatch(
  txs: Transaction[],
  category: string,
  subcategory: string | null,
  ym: string,
  startDay: number,
  today: string
): CategoryWatch {
  const full = periodRange(ym, startDay);
  const started = today >= full.from;
  const to = today < full.to ? today : full.to;
  const nowDays = started ? spanDays(full.from, to) : 0;

  const first = txs.reduce((mn, t) => (mn === "" || t.date < mn ? t.date : mn), "");
  const firstYm = first ? periodKey(first, startDay) : "";

  const own = txs.filter((t) => inWatched(t, category, subcategory) && amountOf(t) !== 0);
  const sum = (from: string, until: string) => {
    let total = 0;
    let count = 0;
    for (const t of own)
      if (t.date >= from && t.date <= until) {
        total += amountOf(t);
        count++;
      }
    return { total, count };
  };

  const now = started ? sum(full.from, to) : { total: 0, count: 0 };

  // Среднее — по полным месяцам истории, за столько же дней от их начала.
  const parts: number[] = [];
  for (let k = 1; k <= WATCH_AVG_MONTHS; k++) {
    const w = shiftPeriod(ym, -k);
    if (firstYm === "" || w <= firstYm) break;
    const r = periodRange(w, startDay);
    const end = endAfterDays(r.from, Math.max(nowDays, 1));
    parts.push(sum(r.from, end < r.to ? end : r.to).total);
  }

  const bars: WatchBar[] = [];
  for (let k = WATCH_BARS - 1; k >= 0; k--) {
    const w = shiftPeriod(ym, -k);
    if (k > 0 && (firstYm === "" || w < firstYm)) continue;
    const r = periodRange(w, startDay);
    bars.push({
      ym: w,
      total: k === 0 ? now.total : sum(r.from, r.to).total,
      current: k === 0,
    });
  }

  return {
    nowAt: now.total,
    count: now.count,
    avgAt: parts.length > 0 && nowDays > 0 ? parts.reduce((s, v) => s + v, 0) / parts.length : null,
    avgMonths: nowDays > 0 ? parts.length : 0,
    running: started && to < full.to,
    bars,
  };
}
