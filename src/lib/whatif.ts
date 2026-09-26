import type { Transaction } from "../types";
import { groupByMonth } from "./aggregations";
import { currentPeriod, periodKey, periodRange, shiftPeriod, spanDays } from "./period";

/**
 * Сценарии «Что-если»: как изменится капитал, если поменять доходы, расходы
 * или случится крупное событие.
 *
 * Всё считается в СЕГОДНЯШНИХ деньгах. Инфляция не раздувает суммы, а
 * уменьшает доходность: капитал растёт на реальную доходность
 * `(1 + доходность) / (1 + инфляция) − 1`. Так «через 10 лет 5 млн» значит
 * 5 млн нынешними, и его можно сравнивать с тем, что есть сейчас, и с целью
 * FIRE, которая тоже в нынешних деньгах.
 */

export type WhatIfBasis = "average" | "median";

/** Точка отсчёта — ваши доход и расход за последние законченные месяцы. */
export interface WhatIfBase {
  avgIncome: number;
  avgExpense: number;
  avgSavings: number;
  savingsRate: number;
  /** Месяцы, по которым посчитано, по возрастанию. */
  months: string[];
  /** Доход и расход каждого из этих месяцев — чтобы среднее можно было проверить. */
  monthly: { ym: string; income: number; expense: number }[];
}

export interface BaseOptions {
  monthStartDay?: number;
  /** Сколько последних законченных месяцев брать. */
  months?: number;
  basis?: WhatIfBasis;
  today?: Date;
}

/**
 * Законченные месяцы с операциями — последние `count`.
 *
 * Идущий месяц не берём: к середине месяца в нём половина трат и почти вся
 * зарплата, и средние по нему врут в обе стороны. Так же — последний месяц
 * данных, если они обрываются задолго до его конца: выгрузка CSV, сделанная
 * в середине мая, даёт май без зарплаты, и среднее проседает на шестую часть.
 * Если законченных нет совсем (данных на один месяц), считаем по тому, что есть.
 */
function recentMonths(
  transactions: Transaction[],
  count: number,
  monthStartDay: number,
  today: Date
) {
  const all = groupByMonth(transactions, { monthStartDay });
  const running = currentPeriod(monthStartDay, today);
  let lastDate = "";
  for (const t of transactions) if (t.kind !== "transfer" && t.date > lastDate) lastDate = t.date;
  const cut = lastDate ? cutMonth(lastDate, monthStartDay) : null;
  const done = all.filter((m) => m.ym < running && m.ym !== cut);
  return (done.length > 0 ? done : all).slice(-count);
}

/** Сколько дней тишины в конце месяца считаем обрывом данных, а не затишьем. */
const CUT_GAP_DAYS = 7;

/**
 * Месяц, на котором данные обрываются, — или `null`, если последний месяц
 * данных дошёл почти до конца. Неделя без операций в конце месяца бывает и
 * у живых данных; обрыв — это когда месяц кончается сильно позже последней
 * операции.
 */
function cutMonth(lastDate: string, monthStartDay: number): string | null {
  const ym = periodKey(lastDate, monthStartDay);
  const gap = spanDays(lastDate, periodRange(ym, monthStartDay).to) - 1;
  return gap > CUT_GAP_DAYS ? ym : null;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function computeWhatIfBase(
  transactions: Transaction[],
  opts: BaseOptions = {}
): WhatIfBase {
  const recent = recentMonths(
    transactions,
    opts.months ?? 6,
    opts.monthStartDay ?? 1,
    opts.today ?? new Date()
  );
  const pick = opts.basis === "median" ? median : mean;
  const avgIncome = pick(recent.map((m) => m.income));
  const avgExpense = pick(recent.map((m) => m.expense));
  const avgSavings = avgIncome - avgExpense;
  return {
    avgIncome,
    avgExpense,
    avgSavings,
    savingsRate: avgIncome > 0 ? avgSavings / avgIncome : 0,
    months: recent.map((m) => m.ym),
    monthly: recent.map((m) => ({ ym: m.ym, income: m.income, expense: m.expense })),
  };
}

export interface CategoryAverage {
  category: string;
  /** Средний расход в месяц, в базовой валюте. */
  monthly: number;
}

/**
 * Средний расход по каждой категории за те же месяцы, что и база, — все
 * категории, от больших к меньшим. Делим на число месяцев базы, а не на
 * месяцы, где категория встречалась: страховка раз в полгода — это шестая
 * часть в месяц, а не вся сумма.
 */
export function avgMonthlyByCategory(
  transactions: Transaction[],
  opts: Omit<BaseOptions, "basis"> = {}
): CategoryAverage[] {
  const monthStartDay = opts.monthStartDay ?? 1;
  const recent = recentMonths(
    transactions,
    opts.months ?? 6,
    monthStartDay,
    opts.today ?? new Date()
  );
  const recentSet = new Set(recent.map((r) => r.ym));
  const count = recent.length || 1;

  const sums = new Map<string, number>();
  for (const t of transactions) {
    // Возврат уменьшает расход своей категории — так же, как общий расход
    // базы. Без этого категория выходила дороже, чем в итогах.
    if (t.kind !== "expense" && t.kind !== "refund") continue;
    if (!recentSet.has(periodKey(t.date, monthStartDay))) continue;
    const sign = t.kind === "refund" ? -1 : 1;
    sums.set(t.category, (sums.get(t.category) || 0) + sign * t.amountBase);
  }

  return Array.from(sums.entries())
    .map(([category, total]) => ({ category, monthly: total / count }))
    .filter((c) => c.monthly > 0)
    .sort((a, b) => b.monthly - a.monthly);
}

/**
 * Событие сценария: разовое («машина в марте 2027») или ежемесячное
 * («ипотека 60 000 с января, 20 лет»). Суммы — в сегодняшних деньгах.
 */
export interface ScenarioEvent {
  id: string;
  title: string;
  kind: "once" | "monthly";
  /** Трата или поступление. */
  sign: "expense" | "income";
  amount: number;
  /** Месяц начала, `YYYY-MM`. */
  start: string;
  /** Сколько месяцев длится ежемесячное; `null` — без конца. */
  months: number | null;
}

/** Рычаги одного сценария. */
export interface ScenarioLevers {
  /** Множитель дохода: 1 — без изменений, 1.2 — +20%. */
  incomeMul: number;
  /** Множитель расхода: 0.9 — −10%. Применяется ПОСЛЕ категорий. */
  expenseMul: number;
  /** Сколько откладывать сверх нынешнего «доход − расход». */
  extraMonthlySave: number;
  /** Множители по категориям: `{ Кафе: 0.5 }` — вдвое меньше. */
  categoryMul: Record<string, number>;
  events: ScenarioEvent[];
}

export const NEUTRAL_LEVERS: ScenarioLevers = {
  incomeMul: 1,
  expenseMul: 1,
  extraMonthlySave: 0,
  categoryMul: {},
  events: [],
};

/** Допущения — общие для всех сценариев. */
export interface WhatIfAssumptions {
  /** Доходность капитала, % годовых. */
  returnPct: number;
  /** Инфляция, % годовых. */
  inflationPct: number;
  /** На сколько лет вперёд смотреть; 0 — «До FIRE», см. `autoHorizonYears`. */
  horizonYears: number;
  /** По скольким законченным месяцам считать базу. */
  baseMonths: number;
  basis: WhatIfBasis;
  /** Доля капитала, которую можно тратить в год на FIRE: 4% — правило 4%. */
  withdrawalPct: number;
  /**
   * Рост дохода, % в год сверх инфляции: повышения, опыт, карьера. Траты при
   * этом те же — разница уходит в накопления.
   */
  incomeGrowthPct: number;
}

export const DEFAULT_ASSUMPTIONS: WhatIfAssumptions = {
  returnPct: 0,
  inflationPct: 0,
  horizonYears: 0,
  baseMonths: 6,
  basis: "average",
  withdrawalPct: 4,
  incomeGrowthPct: 0,
};

export interface ProjectionPoint {
  /** Месяц, `YYYY-MM`; первая точка — сегодняшний капитал. */
  ym: string;
  capital: number;
}

export interface Projection {
  income: number;
  expense: number;
  /** Откладывается в обычный месяц — без событий. */
  savings: number;
  rate: number;
  /** Капитал для FIRE: годовые траты ÷ доля изъятия. */
  fireTarget: number;
  /** Месяц, когда капитал дорастёт до цели; `null` — не дорастёт за 100 лет. */
  fireYm: string | null;
  /** Лет до FIRE; `Infinity` — не дорастёт. */
  yearsToFire: number;
  /** Траектория на горизонт, по месяцам. */
  points: ProjectionPoint[];
  /** Капитал на конец горизонта. */
  capitalAtHorizon: number;
  /** Сумма событий по месяцам горизонта (для подсказки графика). */
  eventsByYm: Record<string, number>;
}

/** Реальная месячная доходность: доходность за вычетом инфляции. */
export function realMonthlyRate(a: Pick<WhatIfAssumptions, "returnPct" | "inflationPct">): number {
  const real = (1 + a.returnPct / 100) / (1 + a.inflationPct / 100) - 1;
  return Math.pow(1 + real, 1 / 12) - 1;
}

/** Сколько месяцев от `from` до `to`: «2026-09» → «2027-01» = 4. */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/** Сколько даёт событие в месяце `ym`: трата — минус, поступление — плюс. */
export function eventAmountIn(e: ScenarioEvent, ym: string): number {
  const k = monthsBetween(e.start, ym);
  if (k < 0) return 0;
  const on = e.kind === "once" ? k === 0 : e.months == null || k < e.months;
  if (!on) return 0;
  return e.sign === "income" ? e.amount : -e.amount;
}

/** Доход и расход сценария в обычный месяц — без событий. */
export function steadyFlows(
  base: WhatIfBase,
  levers: ScenarioLevers,
  categories: CategoryAverage[]
) {
  const income = base.avgIncome * levers.incomeMul;
  let delta = 0;
  for (const c of categories) {
    const mul = levers.categoryMul[c.category];
    if (mul !== undefined) delta += c.monthly * (mul - 1);
  }
  const expense = Math.max(0, (base.avgExpense + delta) * levers.expenseMul);
  const savings = income - expense + levers.extraMonthlySave;
  return { income, expense, savings, rate: income > 0 ? savings / income : 0 };
}

const FIRE_SEARCH_MONTHS = 100 * 12;

/**
 * Траектория капитала по месяцам.
 *
 * Каждый месяц капитал растёт на реальную доходность, к нему прибавляется то,
 * что откладывается, и события этого месяца. Капитал может уйти в минус —
 * покупка больше накоплений — и мы это показываем, а не прячем за нулём.
 *
 * Цель FIRE — годовые траты сценария, делённые на долю изъятия. Бессрочные
 * ежемесячные траты (ипотека без конца, аренда) входят в траты: на них тоже
 * придётся жить с капитала. Траты со сроком — нет: к FIRE они закончатся.
 */
export function project(
  base: WhatIfBase,
  levers: ScenarioLevers,
  categories: CategoryAverage[],
  assumptions: WhatIfAssumptions,
  startingCapital: number,
  startYm: string
): Projection {
  const flows = steadyFlows(base, levers, categories);
  const forever = levers.events
    .filter((e) => e.kind === "monthly" && e.months == null && e.sign === "expense")
    .reduce((s, e) => s + e.amount, 0);
  const withdrawal = Math.max(0.1, assumptions.withdrawalPct) / 100;
  const fireTarget = ((flows.expense + forever) * 12) / withdrawal;
  const r = realMonthlyRate(assumptions);
  // Рост дохода — помесячно, сложным процентом: за год ровно заданный процент.
  const g = Math.pow(1 + (assumptions.incomeGrowthPct ?? 0) / 100, 1 / 12) - 1;
  const horizon = Math.max(1, Math.round(assumptions.horizonYears)) * 12;

  const points: ProjectionPoint[] = [{ ym: startYm, capital: startingCapital }];
  const eventsByYm: Record<string, number> = {};
  let capital = startingCapital;
  let fireMonth: number | null = capital >= fireTarget && fireTarget > 0 ? 0 : null;
  const last = Math.max(horizon, fireMonth === null ? FIRE_SEARCH_MONTHS : 0);
  for (let k = 1; k <= last; k++) {
    // Траектория начинается с капитала на сегодня и шагает на месяц вперёд.
    // События ТЕКУЩЕГО месяца ложатся в первый шаг: иначе трата, назначенная
    // на этот месяц, не попадала в расчёт вовсе.
    const ym = shiftPeriod(startYm, k);
    let ev = levers.events.reduce((s, e) => s + eventAmountIn(e, ym), 0);
    if (k === 1) ev += levers.events.reduce((s, e) => s + eventAmountIn(e, startYm), 0);
    // Доходность — только на то, что есть: ушедший в минус капитал (покупка
    // больше накоплений) под процент вклада не «растёт», а ставку по долгу
    // мы не знаем.
    const raise = flows.income * (Math.pow(1 + g, k - 1) - 1);
    capital = capital + Math.max(0, capital) * r + flows.savings + raise + ev;
    if (k <= horizon) {
      points.push({ ym, capital });
      if (ev !== 0) eventsByYm[ym] = ev;
    }
    if (fireMonth === null && fireTarget > 0 && capital >= fireTarget) fireMonth = k;
    if (k >= horizon && fireMonth !== null) break;
  }

  return {
    ...flows,
    fireTarget,
    fireYm: fireMonth === null ? null : shiftPeriod(startYm, fireMonth),
    yearsToFire: fireMonth === null ? Infinity : fireMonth / 12,
    points,
    capitalAtHorizon: points[points.length - 1].capital,
    eventsByYm,
  };
}

/** Самый длинный горизонт графика — столько же, сколько ищем FIRE. */
export const MAX_HORIZON_YEARS = 100;

/**
 * Горизонт «До FIRE»: до самого позднего FIRE среди сценариев на графике и
 * ещё год, чтобы точка не стояла на краю. FIRE не наступает ни у одного —
 * 30 лет; наступает уже сейчас — 5, чтобы было на что смотреть.
 */
export function autoHorizonYears(fireYears: readonly number[]): number {
  const finite = fireYears.filter((y) => Number.isFinite(y));
  if (finite.length === 0) return 30;
  const far = Math.ceil(Math.max(...finite)) + 1;
  return Math.min(MAX_HORIZON_YEARS, Math.max(5, far));
}
