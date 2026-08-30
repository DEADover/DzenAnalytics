/**
 * Сравнение отчётного месяца с предыдущим — модель виджета «Месяц к месяцу».
 *
 * Главная отвечает на вопрос «сколько», но не отвечает на «нормально ли это»:
 * «Итоги месяца» показывают только текущий, и сравнить его не с чем.
 *
 * Главное здесь — ЧЕСТНОСТЬ НЕПОЛНОГО МЕСЯЦА. Пока месяц идёт, от предыдущего
 * берётся ровно столько же дней: третьего числа любой месяц выглядел бы
 * провалом рядом с целым прошлым, и виджет каждый месяц начинался бы с вранья.
 * Ту же подрезку делает «Сравнение периодов» — берём её же `comparableRanges`,
 * чтобы два места в сервисе не разошлись в трактовке.
 */

import type { Transaction } from "../types";
import { computeKPI } from "./aggregations";
import {
  comparableRanges,
  periodRange,
  shiftPeriod,
  spanDays,
  type DayRange,
} from "./period";

/** Один показатель: сколько сейчас, сколько было и насколько разошлось. */
export interface MoMMetric {
  now: number;
  prev: number;
  /** Разница в единицах показателя: рубли, доли, штуки. */
  delta: number;
  /**
   * Относительная разница долей единицы. `null` — считать не от чего:
   * в прошлом месяце ноль, и любой процент от него был бы выдуман.
   */
  ratio: number | null;
}

export interface MonthOverMonth {
  /** Окна, по которым посчитано, — уже подрезанные до сравнимых. */
  now: DayRange;
  prev: DayRange;
  /** Сколько дней взято от каждого месяца. */
  days: number;
  /** Сколько дней в отчётном месяце целиком. */
  daysInMonth: number;
  /** Месяц ещё идёт, поэтому окна подрезаны. */
  running: boolean;
  income: MoMMetric;
  expense: MoMMetric;
  net: MoMMetric;
  /** Норма сбережений ДОЛЕЙ единицы: 0,797 — это 79,7 %. */
  savingsRate: MoMMetric;
  /** Средний расход на операцию. */
  avgExpense: MoMMetric;
}

function metric(now: number, prev: number): MoMMetric {
  return {
    now,
    prev,
    delta: now - prev,
    // От нуля процент не считается. Ноль вместо `null` читался бы как «не
    // изменилось», хотя изменилось с нуля до чего угодно.
    ratio: prev === 0 ? null : (now - prev) / Math.abs(prev),
  };
}

/**
 * Собрать сравнение. `today` — последний день, за который есть данные (в
 * приложении это дата последней операции, а не системная: по обрезанной
 * истории «сегодня» из часов дало бы пустой хвост окна).
 */
export function monthOverMonth(
  txs: Transaction[],
  ym: string,
  monthStartDay: number,
  today: string
): MonthOverMonth {
  const full = periodRange(ym, monthStartDay);
  const prevFull = periodRange(shiftPeriod(ym, -1), monthStartDay);
  const fit = comparableRanges(full, prevFull, today, true);

  const inRange = (t: Transaction, r: DayRange) => t.date >= r.from && t.date <= r.to;
  const kpiNow = computeKPI(txs.filter((t) => inRange(t, fit.a)));
  const kpiPrev = computeKPI(txs.filter((t) => inRange(t, fit.b)));

  const rate = (k: { net: number; income: number }) =>
    k.income > 0 ? k.net / k.income : 0;

  return {
    now: fit.a,
    prev: fit.b,
    days: spanDays(fit.a.from, fit.a.to),
    daysInMonth: spanDays(full.from, full.to),
    // «Идёт» — это про подрезку: конец окна не дотянул до конца месяца.
    running: fit.a.to !== full.to,
    income: metric(kpiNow.income, kpiPrev.income),
    expense: metric(kpiNow.expense, kpiPrev.expense),
    net: metric(kpiNow.net, kpiPrev.net),
    savingsRate: metric(rate(kpiNow), rate(kpiPrev)),
    avgExpense: metric(kpiNow.avgExpense, kpiPrev.avgExpense),
  };
}

/**
 * Стало ли лучше. Для расходов и среднего чека «меньше» — это хорошо, для
 * остальных наоборот; без этого виджет красил бы упавшие траты в красный.
 * `null` — не изменилось (или считать не от чего).
 */
export function isImprovement(m: MoMMetric, lowerIsBetter: boolean): boolean | null {
  if (m.delta === 0) return null;
  return lowerIsBetter ? m.delta < 0 : m.delta > 0;
}
