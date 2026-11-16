/**
 * Тренды категорий — какие статьи растут из месяца в месяц, какие снижаются,
 * а какие просто колеблются.
 *
 * Помесячный график отвечает на вопрос «сколько было в каждом месяце», но не
 * на вопрос «куда это идёт»: на двадцати линиях рост одной статьи не разглядеть.
 * Здесь каждая категория получает ряд по ПОЛНЫМ месяцам периода и группу.
 *
 * Группа — по линии тренда, а не по двум крайним месяцам: категория, которая
 * полгода росла, а в последний месяц случайно оказалась пустой, всё равно
 * растущая. Через месяцы проводится прямая (наименьшие квадраты); если по ней
 * за период набегает больше четверти среднего месяца — категория растёт или
 * снижается, иначе плавает.
 */

import type { Transaction } from "../types";
import { periodKey, shiftPeriod } from "./period";
import { affectsExpense, expenseDelta } from "./txKindStyle";

export type TrendGroup = "rising" | "floating" | "falling";

/** Доля среднего месяца, которую тренд должен набрать за период, чтобы считаться ростом или снижением. */
export const TREND_THRESHOLD = 0.25;

/** Меньше месяцев — тренда нет: по двум точкам прямая проходит всегда. */
export const TREND_MIN_MONTHS = 3;

export interface CategoryTrend {
  category: string;
  /** Суммы по месяцам `months`, по порядку. */
  values: number[];
  /** Первый и последний полный месяц периода. */
  first: number;
  last: number;
  /** Сколько набегает по линии тренда от первого месяца до последнего. */
  trendChange: number;
  group: TrendGroup;
}

/** Группа и изменение по линии тренда для ряда месячных сумм. */
export function trendOf(values: readonly number[]): { group: TrendGroup; trendChange: number } {
  const n = values.length;
  if (n < TREND_MIN_MONTHS) return { group: "floating", trendChange: 0 };
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  values.forEach((v, i) => {
    num += (i - meanX) * (v - meanY);
    den += (i - meanX) ** 2;
  });
  const trendChange = den > 0 ? (num / den) * (n - 1) : 0;
  if (meanY <= 0) return { group: "floating", trendChange };
  const rel = trendChange / meanY;
  const group: TrendGroup = rel >= TREND_THRESHOLD ? "rising" : rel <= -TREND_THRESHOLD ? "falling" : "floating";
  return { group, trendChange };
}

/**
 * Полные отчётные месяцы среди операций: от самого раннего до последнего
 * законченного, без пропусков. Идущий месяц не берём — он заведомо меньше
 * остальных и превратил бы каждую категорию в «снижающуюся».
 */
export function fullMonths(txs: readonly Transaction[], monthStartDay: number, today: string): string[] {
  let min = "";
  let max = "";
  for (const t of txs) {
    if (!t.date) continue;
    const ym = periodKey(t.date, monthStartDay);
    if (!min || ym < min) min = ym;
    if (!max || ym > max) max = ym;
  }
  if (!min) return [];
  const running = periodKey(today, monthStartDay);
  if (max >= running) max = shiftPeriod(running, -1);
  const out: string[] = [];
  for (let ym = min; ym <= max; ym = shiftPeriod(ym, 1)) out.push(ym);
  return out;
}

/**
 * Ряды и группы по категориям. `months` — из `fullMonths`. Возвращает и общий
 * ряд по всем категориям (`total`).
 */
export function categoryTrends(
  txs: readonly Transaction[],
  opts: { level: "top" | "full"; kind: "expense" | "income"; monthStartDay: number; months: readonly string[] }
): { rows: CategoryTrend[]; total: CategoryTrend } {
  const { level, kind, monthStartDay, months } = opts;
  const index = new Map(months.map((ym, i) => [ym, i] as const));
  const byCat = new Map<string, number[]>();
  const totalValues = months.map(() => 0);
  for (const t of txs) {
    // Расходы — за вычетом возвратов того же месяца; доходы — как есть.
    const include = kind === "expense" ? affectsExpense(t.kind) : t.kind === kind;
    if (!include || !t.date) continue;
    const i = index.get(periodKey(t.date, monthStartDay));
    if (i === undefined) continue;
    const cat = level === "top" ? t.category : t.categoryFull;
    let values = byCat.get(cat);
    if (!values) {
      values = months.map(() => 0);
      byCat.set(cat, values);
    }
    const amount = kind === "expense" ? expenseDelta(t) : t.amountBase;
    values[i] += amount;
    totalValues[i] += amount;
  }
  const make = (category: string, values: number[]): CategoryTrend => ({
    category,
    values,
    first: values[0] ?? 0,
    last: values[values.length - 1] ?? 0,
    ...trendOf(values),
  });
  const rows = [...byCat.entries()]
    // Категория, у которой за период ничего не набралось (или возвраты
    // перекрыли траты), в трендах не нужна.
    .filter(([, values]) => values.reduce((s, v) => s + v, 0) > 0)
    .map(([category, values]) => make(category, values));
  return { rows, total: make("", totalValues) };
}
