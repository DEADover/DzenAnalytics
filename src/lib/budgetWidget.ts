/**
 * Строки виджета «Бюджет месяца» на главной: расходные статьи с планом, от
 * самой «горячей» к самой спокойной.
 *
 * План и факт приходят готовыми из расчёта раздела «Бюджет»
 * (`budgetPlanRows`), чтобы виджет и раздел не разошлись ни в одной сумме.
 * Здесь только отбор и порядок.
 */

import type { BudgetMonthRow } from "./budgetMonth";

export interface BudgetWidgetRow {
  key: string;
  category: string;
  subcategory: string | null;
  planned: number;
  fact: number;
  /** Какая доля плана потрачена; больше единицы — перерасход. */
  ratio: number;
  /** План — прогноз, а не заданная сумма. */
  forecast: boolean;
}

export interface BudgetWidget {
  /** Все расходные статьи с планом, самые потраченные первыми. */
  rows: BudgetWidgetRow[];
  /** У скольких статей план уже превышен. */
  over: number;
}

export function buildBudgetWidget(rows: readonly BudgetMonthRow[]): BudgetWidget {
  const out: BudgetWidgetRow[] = [];
  for (const r of rows) {
    if (r.line.kind !== "expense") continue;
    if (r.planGroup || r.opening || r.unplanned) continue;
    if (!(r.planned > 0)) continue;
    const subcategory = r.line.subcategory ?? null;
    out.push({
      key: `${r.line.category}|${subcategory ?? ""}`,
      category: r.line.category,
      subcategory,
      planned: r.planned,
      fact: r.fact,
      ratio: r.fact / r.planned,
      forecast: r.forecast,
    });
  }
  // При равной доле выше та статья, где на кону больше денег.
  out.sort((a, b) => b.ratio - a.ratio || b.planned - a.planned);
  return { rows: out, over: out.filter((r) => r.fact > r.planned + 0.5).length };
}
