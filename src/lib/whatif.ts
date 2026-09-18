import type { Transaction } from "../types";
import { groupByMonth } from "./aggregations";
import { periodKey } from "./period";

export interface WhatIfBase {
  avgIncome: number;       // base monthly income, last 6 months
  avgExpense: number;      // base monthly expense, last 6 months
  avgSavings: number;
  savingsRate: number;
  annualExpense: number;
  fireTarget: number;       // expense * 12 * 25
  yearsToFireBase: number;  // years to FIRE at current rate, from zero
}

export interface WhatIfInputs {
  /** Multiplier on income, 1 = unchanged, 1.2 = +20% raise */
  incomeMul: number;
  /** Multiplier on expense, 1 = unchanged, 0.9 = −10% */
  expenseMul: number;
  /** Extra monthly amount to save (forced delta) */
  extraMonthlySave: number;
  /** Current capital (starting balance for projections), in base currency */
  startingCapital: number;
  /** Per-category expense multipliers (e.g. { "Кафе": 0.5 }) */
  categoryMul?: Record<string, number>;
}

export interface WhatIfOutputs {
  newIncome: number;
  newExpense: number;
  newSavings: number;
  newRate: number;
  /** Years to FIRE under new conditions */
  yearsToFire: number;
  /** Capital projected at +1, +5, +10 years */
  projected1y: number;
  projected5y: number;
  projected10y: number;
  /** Per-year savings delta vs base scenario */
  annualSavingsDelta: number;
  /** Years saved on FIRE timeline vs base */
  yearsSavedOnFire: number;
}

export function computeWhatIfBase(
  transactions: Transaction[],
  monthStartDay = 1
): WhatIfBase {
  const months = groupByMonth(transactions, { monthStartDay });
  const recent = months.slice(-6);
  const avgIncome =
    recent.length > 0
      ? recent.reduce((s, m) => s + m.income, 0) / recent.length
      : 0;
  const avgExpense =
    recent.length > 0
      ? recent.reduce((s, m) => s + m.expense, 0) / recent.length
      : 0;
  const avgSavings = avgIncome - avgExpense;
  const savingsRate = avgIncome > 0 ? avgSavings / avgIncome : 0;
  const annualExpense = avgExpense * 12;
  const fireTarget = annualExpense * 25;
  const yearsToFireBase =
    avgSavings > 0 ? fireTarget / (avgSavings * 12) : Infinity;

  return {
    avgIncome,
    avgExpense,
    avgSavings,
    savingsRate,
    annualExpense,
    fireTarget,
    yearsToFireBase,
  };
}

export interface CategoryAverage {
  category: string;
  monthly: number; // average monthly expense in base currency
}

export function avgMonthlyByCategory(
  transactions: Transaction[],
  topN = 8,
  monthStartDay = 1
): CategoryAverage[] {
  const months = groupByMonth(transactions, { monthStartDay });
  const recent = months.slice(-6);
  const recentSet = new Set(recent.map((r) => r.ym));
  const recentMonths = recent.length || 1;

  const sums = new Map<string, number>();
  for (const t of transactions) {
    if (t.kind !== "expense") continue;
    if (!recentSet.has(periodKey(t.date, monthStartDay))) continue;
    sums.set(t.category, (sums.get(t.category) || 0) + t.amountBase);
  }

  return Array.from(sums.entries())
    .map(([category, total]) => ({ category, monthly: total / recentMonths }))
    .sort((a, b) => b.monthly - a.monthly)
    .slice(0, topN);
}

export function computeWhatIf(
  base: WhatIfBase,
  inputs: WhatIfInputs,
  categoryAverages: CategoryAverage[]
): WhatIfOutputs {
  const newIncome = base.avgIncome * inputs.incomeMul;

  // Recompute expense: start from baseline, apply per-category multipliers,
  // then apply global expense multiplier.
  let categoryAdjustedExpense = base.avgExpense;
  if (inputs.categoryMul) {
    let delta = 0;
    for (const ca of categoryAverages) {
      const mul = inputs.categoryMul[ca.category];
      if (mul === undefined) continue;
      delta += ca.monthly * (mul - 1);
    }
    categoryAdjustedExpense = base.avgExpense + delta;
  }
  const newExpense = Math.max(0, categoryAdjustedExpense * inputs.expenseMul);

  const newSavings = newIncome - newExpense + inputs.extraMonthlySave;
  const newRate = newIncome > 0 ? newSavings / newIncome : 0;

  // FIRE under new conditions: target = newExpense * 12 * 25.
  const newFireTarget = newExpense * 12 * 25;
  const startingCapital = Math.max(0, inputs.startingCapital);

  const yearsToFire =
    newSavings > 0
      ? Math.max(0, (newFireTarget - startingCapital) / (newSavings * 12))
      : Infinity;

  const projected = (years: number) =>
    startingCapital + newSavings * 12 * years;

  const annualSavingsDelta = (newSavings - base.avgSavings) * 12;

  const yearsSavedOnFire =
    Number.isFinite(base.yearsToFireBase) && Number.isFinite(yearsToFire)
      ? base.yearsToFireBase - yearsToFire
      : 0;

  return {
    newIncome,
    newExpense,
    newSavings,
    newRate,
    yearsToFire,
    projected1y: projected(1),
    projected5y: projected(5),
    projected10y: projected(10),
    annualSavingsDelta,
    yearsSavedOnFire,
  };
}
