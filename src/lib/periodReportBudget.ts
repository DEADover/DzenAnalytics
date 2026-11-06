/**
 * Бюджет в «Отчёте за период» — месяц ровно так, как его показывает раздел
 * «Бюджеты».
 *
 * Статьи и итоги приходят из того же расчёта, что у раздела
 * (`lib/budgetMonth`): план с прогнозами и назначенными операциями Дзен-мани,
 * факт со статьями без плана, «Без категории» и переводами по правилам
 * «Планов», входящий баланс. Здесь — только свёртка для листа отчёта: статьи
 * по категориям, «вне плана» одной строкой и группы переводов.
 */

import type { BudgetMonthRow, BudgetMonthTotals } from "./budgetMonth";
import { rowPlanForTotal } from "./budgetMonth";

export interface ReportBudgetRow {
  category: string;
  plan: number;
  fact: number;
}

export interface ReportBudget {
  /** Отчётный месяц «YYYY-MM». */
  month: string;
  /** «Поступления» или «Деньги на месяц» (учитывается входящий баланс) — как в разделе. */
  incomeTitle: string;
  /** Итоги карточек раздела: план и факт поступлений, расходов и разница. */
  income: { plan: number; fact: number };
  expense: { plan: number; fact: number };
  delta: { plan: number; fact: number };
  /** Статьи расходов с планом, по категориям, — по убыванию плана. */
  rows: ReportBudgetRow[];
  /** Расходы в статьях без плана, включая «Без категории». */
  unplanned: number;
  /** Переводы по правилам «Планов»: «Кредиты и кредитки», «Накопления»… */
  groups: { category: string; fact: number }[];
}

/**
 * Свернуть строки месяца для отчёта. Сумма статей, «вне плана» и групп
 * переводов равна факту расходов в карточке раздела.
 */
export function reportBudgetFromMonth(
  rows: readonly BudgetMonthRow[],
  totals: BudgetMonthTotals,
  month: string,
  withOpening: boolean
): ReportBudget | null {
  if (totals.expense.plan <= 0 && totals.income.plan <= 0) return null;
  const planOf = rowPlanForTotal(rows);
  const byCategory = new Map<string, ReportBudgetRow>();
  const groups = new Map<string, number>();
  let unplanned = 0;
  for (const r of rows) {
    if (r.line.kind !== "expense") continue;
    if (r.planGroup) {
      groups.set(r.line.category, (groups.get(r.line.category) ?? 0) + r.fact);
      continue;
    }
    if (r.unplanned) {
      unplanned += r.fact;
      continue;
    }
    const row = byCategory.get(r.line.category) ?? { category: r.line.category, plan: 0, fact: 0 };
    row.plan += planOf(r);
    row.fact += r.fact;
    byCategory.set(r.line.category, row);
  }
  return {
    month,
    incomeTitle: withOpening ? "Деньги на месяц" : "Поступления",
    income: totals.income,
    expense: totals.expense,
    delta: totals.delta,
    rows: [...byCategory.values()].filter((r) => r.plan !== 0 || r.fact !== 0).sort((a, b) => b.plan - a.plan),
    unplanned,
    groups: [...groups.entries()].filter(([, fact]) => Math.abs(fact) >= 0.005).map(([category, fact]) => ({ category, fact })),
  };
}
