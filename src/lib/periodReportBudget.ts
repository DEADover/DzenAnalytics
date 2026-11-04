/**
 * Бюджет в «Отчёте за период»: план и факт по статьям расходов за отчётные
 * месяцы периода.
 *
 * Бюджет в сервисе помесячный, поэтому план периода — сумма планов его
 * отчётных месяцев, а факт — по тем же месяцам и по тем же правилам, что в
 * разделе «Бюджеты»: периметр счетов, переводы по правилам «Планов» Дзен-мани
 * (`budgetHits`), замок родителя — его план уже включает подкатегории
 * (`planTotals`).
 */

import type { Transaction } from "../types";
import { lockedFor, plannedFor, type BudgetLine } from "./budgets";
import { budgetHits, type BudgetScope } from "./budgetScope";
import { periodKey } from "./period";

export interface ReportBudgetRow {
  category: string;
  plan: number;
  fact: number;
}

export interface ReportBudget {
  /** Отчётные месяцы, по которым сложены план и факт. */
  months: string[];
  plan: { income: number; expense: number };
  fact: { income: number; expense: number };
  /** Статьи расходов с планом — по убыванию плана. */
  rows: ReportBudgetRow[];
  /** Факт по статьям расходов с планом — его и сравниваем с планом. */
  plannedFact: number;
  /** Траты в статьях без плана. */
  unplanned: number;
}

const key = (kind: string, category: string) => `${kind}\u0000${category}`;

export function buildReportBudget(
  lines: readonly BudgetLine[],
  txs: readonly Transaction[],
  months: readonly string[],
  scope: BudgetScope,
  monthStartDay: number
): ReportBudget | null {
  if (months.length === 0) return null;

  // План по статьям (категория целиком) и итоги — как `planTotals`. Ключ —
  // статья и месяц: факт статьи берём только за месяцы, где у неё есть план,
  // иначе план одного месяца сравнивался бы с тратами всего периода.
  const planBy = new Map<string, number>();
  const plan = { income: 0, expense: 0 };
  for (const ym of months) {
    const locked = new Set<string>();
    for (const l of lines) if (!l.subcategory && lockedFor(l, ym)) locked.add(key(l.kind, l.category));
    for (const l of lines) {
      if (l.subcategory && locked.has(key(l.kind, l.category))) continue;
      const p = plannedFor(l, ym);
      if (p === 0) continue;
      if (l.kind === "income") plan.income += p;
      else plan.expense += p;
      const k = `${key(l.kind, l.category)}\u0000${ym}`;
      planBy.set(k, (planBy.get(k) ?? 0) + p);
    }
  }
  if (plan.expense <= 0 && plan.income <= 0) return null;

  // Факт — по отчётным месяцам периода, по правилам периметра бюджета.
  const inMonths = new Set(months);
  const factBy = new Map<string, number>();
  const fact = { income: 0, expense: 0 };
  for (const t of txs) {
    const ym = periodKey(t.date.slice(0, 10), monthStartDay);
    if (!inMonths.has(ym)) continue;
    for (const hit of budgetHits(t, scope)) {
      if (hit.transfer) continue;
      if (hit.kind === "income") fact.income += hit.amount;
      else fact.expense += hit.amount;
      const k = `${key(hit.kind, hit.category)}\u0000${ym}`;
      factBy.set(k, (factBy.get(k) ?? 0) + hit.amount);
    }
  }

  const byCategory = new Map<string, ReportBudgetRow>();
  for (const [k, p] of planBy) {
    const [kind, category] = k.split("\u0000");
    if (kind === "income" || p <= 0) continue;
    const row = byCategory.get(category) ?? { category, plan: 0, fact: 0 };
    row.plan += p;
    row.fact += factBy.get(k) ?? 0;
    byCategory.set(category, row);
  }
  const rows = [...byCategory.values()].sort((a, b) => b.plan - a.plan);
  const plannedFact = rows.reduce((s, r) => s + r.fact, 0);
  return { months: [...months], plan, fact, rows, plannedFact, unplanned: Math.max(0, fact.expense - plannedFact) };
}
