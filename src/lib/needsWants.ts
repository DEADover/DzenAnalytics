// 50/30/20 split (needs / wants / savings) and the monthly savings-rate
// series — both pure, reusing the same building blocks as the health score
// so the numbers line up with the «Здоровье» page.
//
//   • needs    = expenses in categories that count as «нужда» (mandatory).
//                The caller resolves that set: by default every expense
//                category is mandatory; only Zenmoney's «обязательная» flag set
//                to `false` makes it a want. See Budget503020Page.
//   • wants    = every other expense.
//   • savings  = income − total expense (what's left over).
// Percentages are taken against income, matching the 50/30/20 rule of thumb.
// All amounts are in the base currency (the source aggregations already use
// `amountBase`).

import type { Transaction } from "../types";
import { computeKPI, groupByMonth, isObligatoryTx, type ObligationMeta } from "./aggregations";
import { affectsExpense, expenseDelta } from "./txKindStyle";

export interface NeedsWantsSplit {
  income: number;
  needs: number;
  wants: number;
  /** income − (needs + wants). Negative when overspending. */
  savings: number;
  /** Shares of income (0..1); 0 when income ≤ 0. */
  needsPct: number;
  wantsPct: number;
  savingsPct: number;
}

export function buildNeedsWants(
  txs: Transaction[],
  meta: ObligationMeta
): NeedsWantsSplit {
  let needs = 0;
  let wants = 0;
  for (const t of txs) {
    if (!affectsExpense(t.kind)) continue;
    const d = expenseDelta(t);
    if (isObligatoryTx(t, meta)) needs += d;
    else wants += d;
  }
  const income = computeKPI(txs).income;
  const savings = income - (needs + wants);
  const pct = (x: number) => (income > 0 ? x / income : 0);
  return {
    income,
    needs,
    wants,
    savings,
    needsPct: pct(needs),
    wantsPct: pct(wants),
    savingsPct: pct(savings),
  };
}

export interface SavingsRatePoint {
  ym: string;
  /** (income − expense) / income for the month; 0 when income ≤ 0. */
  rate: number;
}

/** Monthly savings rate over the last `months` buckets (0 = all). Mirrors the
 *  per-month rate used by the health score's savings/stability components. */
export function savingsRateSeries(
  txs: Transaction[],
  months = 12,
  monthStartDay = 1
): SavingsRatePoint[] {
  const buckets = groupByMonth(txs, { monthStartDay });
  const recent = months > 0 ? buckets.slice(-months) : buckets;
  return recent.map((m) => ({
    ym: m.ym,
    rate: m.income > 0 ? (m.income - m.expense) / m.income : 0,
  }));
}
