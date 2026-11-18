/**
 * Производные числа цели: сколько накоплено, сколько осталось и когда она
 * будет достигнута при заданном темпе.
 *
 * Один расчёт на страницу «Цели» и на виджет главной: иначе срок на главной
 * расходился бы со сроком на странице, куда с неё ведёт ссылка.
 */

import type { Goal } from "../store/useGoalsStore";
import type { CurrencyRates } from "../types";
import { goalProgress, type GoalAccount, type RubRates } from "./goals";
import { MONTHS, MONTHS_GEN } from "./months";

function monthsBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso);
  const b = new Date(toIso);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

/** date `months` from the start of the current month, ISO yyyy-mm-dd. Built from
 *  LOCAL fields (not `toISOString`, which shifts to UTC and can roll the 1st back
 *  into the previous month for east-of-UTC zones). */
export function addMonthsIso(months: number): string {
  const d = new Date();
  const t = new Date(d.getFullYear(), d.getMonth() + months, 1);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * «Июль 2043» — месяц полностью и с заглавной буквы: прогноз считается по
 * месяцам, и день был бы ложной точностью. Из полей «год-месяц» напрямую,
 * без пересчёта часовых поясов.
 */
export function monthYear(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return `${MONTHS[(m || 1) - 1] ?? ""} ${y}`;
}

/** «1 сентября 2027» — срок цели: день и месяц полностью, без «г.». */
export function fullDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d || 1} ${MONTHS_GEN[(m || 1) - 1] ?? ""} ${y}`;
}

/** «N мес · Июль 2043», or a short reason when there's no finite finish. */
export function forecastLabel(f: Forecast, done: boolean): string {
  if (done) return "цель достигнута";
  if (f.months === null || !f.finish) return "темп отрицательный";
  return `${f.months} мес · ${monthYear(f.finish)}`;
}

/** Всё, чем цель пересчитывает счета в базовую валюту. */
export interface Money {
  accounts: GoalAccount[];
  rates: CurrencyRates;
  cbr: RubRates;
}

/** One forecast: months left at a given monthly pace, and the finish date. */
export interface Forecast {
  months: number | null; // null = never (pace ≤ 0) ; 0 = already done
  finish: string | null;
}

/** All derived numbers for one goal. Single source of truth for the summary
 *  tiles, the cards and the projection chart, so they can't drift apart. */
export function goalMetrics(g: Goal, money: Money, avgSavings: number) {
  // Привязана к счетам → прогресс = сумма их балансов по курсу ЦБ на сегодня;
  // иначе введённое вручную (#45, #103). Пропавший счёт не обнуляет цель.
  const progress = goalProgress(g, money.accounts, money.rates, money.cbr);
  const current = progress.current;
  const ratio = g.target > 0 ? Math.min(current / g.target, 1) : 0;
  const done = ratio >= 1;
  const remaining = Math.max(g.target - current, 0);
  const contribution =
    g.monthlyContribution && g.monthlyContribution > 0 ? g.monthlyContribution : null;

  const project = (pace: number): Forecast => {
    if (done) return { months: 0, finish: null };
    if (!(pace > 0)) return { months: null, finish: null };
    const months = Math.ceil(remaining / pace);
    return { months, finish: addMonthsIso(months) };
  };
  const byPace = project(avgSavings);
  const byContribution = contribution ? project(contribution) : null;

  // The forecast the deadline verdict is judged against: the user's own planned
  // contribution when set (that's their commitment), else the household pace.
  const effective = byContribution ?? byPace;
  const deadlineMonths = g.deadline
    ? monthsBetween(new Date().toISOString(), g.deadline)
    : null;
  const onTrack =
    effective.months !== null && deadlineMonths !== null && effective.months <= deadlineMonths;

  return {
    current,
    ratio,
    done,
    remaining,
    contribution,
    byPace,
    byContribution,
    effective,
    deadlineMonths,
    onTrack,
    progress,
  };
}
