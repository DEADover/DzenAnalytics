/**
 * «Прогноз остатка» на главной — сколько денег останется на повседневных
 * счетах к концу месяца: остаток по дням до сегодня и дальше, с
 * запланированными операциями в свои дни.
 *
 * Отвечает на вопрос «хватит ли до зарплаты», поэтому считаются только счета,
 * с которых живут: в балансе, не накопительные, не вклады, кредиты и долги.
 * Вклад в три миллиона сделал бы линию плоской и ответ — бессмысленным.
 *
 * Правила прогноза — те же, что у пунктира на графике «Совокупно» в «Счетах»
 * (`lib/balanceForecast`), чтобы два места не разошлись: как план меняет
 * остаток, решает `planDelta`; просроченные планы в прогноз не идут; план на
 * сегодня ложится на завтра — в сам день у линии уже есть настоящий остаток.
 * Повседневные траты «по среднему темпу» не добавляются: это уже догадка, а
 * каждую ступеньку здесь можно проверить по списку запланированных операций.
 */

import { planDelta, type ForecastOp } from "./balanceForecast";
import { endAfterDays, spanDays, type DayRange } from "./period";

export interface OutlookPoint {
  /** День от начала месяца, с 1. */
  day: number;
  date: string;
  /** Остаток по факту; null — день ещё не наступил. */
  fact: number | null;
  /** Прогноз; null — день уже прошёл. В сегодняшней точке равен факту. */
  plan: number | null;
}

export interface BalanceOutlook {
  points: OutlookPoint[];
  /** Остаток сейчас. */
  now: number;
  /** Остаток к концу месяца. */
  end: number;
  /** Самая низкая точка от сегодня до конца месяца. */
  min: { date: string; value: number };
  /** День, когда остаток впервые уходит ниже нуля; null — не уходит. */
  below: string | null;
  /** Сколько ещё спишется и сколько операций. */
  out: number;
  outCount: number;
  /** Сколько ещё придёт, сколько операций и когда ближайшее поступление. */
  income: number;
  incomeCount: number;
  nextIncome: string | null;
}

/** Типы счетов, с которых не живут: вклад, кредит, долги. */
const NOT_EVERYDAY = new Set(["deposit", "loan", "debt"]);

/** Повседневный ли счёт — из таких складывается «хватит ли до зарплаты». */
export function isEverydayAccount(a: {
  type: string;
  archive: boolean;
  inBalance: boolean;
  savings: boolean;
}): boolean {
  return a.inBalance && !a.archive && !a.savings && !NOT_EVERYDAY.has(a.type);
}

export function buildBalanceOutlook(
  /** Остаток этих счетов по дням: точки там, где он менялся. */
  series: readonly { date: string; net: number }[],
  /** Отчётный месяц целиком. */
  range: DayRange,
  today: string,
  ops: readonly ForecastOp[],
  picked: (account: string) => boolean
): BalanceOutlook {
  const days = spanDays(range.from, range.to);
  // Последний известный остаток на день: ряд редкий, между точками он стоит.
  const at = (date: string): number => {
    let net = 0;
    for (const p of series) {
      if (p.date > date) break;
      net = p.net;
    }
    return net;
  };
  const now = at(today);

  const tomorrow = endAfterDays(today, 2);
  const steps: { date: string; amount: number }[] = [];
  let out = 0;
  let outCount = 0;
  let income = 0;
  let incomeCount = 0;
  let nextIncome: string | null = null;
  for (const op of ops) {
    if (op.date < today || op.date > range.to) continue;
    const amount = planDelta(op as ForecastOp, picked);
    if (amount === 0) continue;
    steps.push({ date: op.date === today ? tomorrow : op.date, amount });
    if (amount < 0) {
      out += -amount;
      outCount++;
    } else {
      income += amount;
      incomeCount++;
      if (nextIncome === null || op.date < nextIncome) nextIncome = op.date;
    }
  }

  const points: OutlookPoint[] = [];
  let min = { date: today, value: now };
  let below: string | null = now < 0 ? today : null;
  let end = now;
  for (let i = 0; i < days; i++) {
    const date = endAfterDays(range.from, i + 1);
    let plan: number | null = null;
    if (date >= today) {
      plan = now;
      for (const s of steps) if (s.date <= date) plan += s.amount;
      if (plan < min.value) min = { date, value: plan };
      if (below === null && plan < 0) below = date;
      end = plan;
    }
    points.push({ day: i + 1, date, fact: date <= today ? at(date) : null, plan });
  }
  // План на сегодня в последний день месяца «на завтра» уже не помещается —
  // в итог он всё равно входит.
  if (today >= range.to) {
    end = now + steps.reduce((s, x) => s + x.amount, 0);
    if (end < min.value) min = { date: range.to, value: end };
    if (below === null && end < 0) below = range.to;
  }

  return { points, now, end, min, below, out, outCount, income, incomeCount, nextIncome };
}
