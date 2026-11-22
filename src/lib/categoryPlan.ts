/**
 * План месяца для засечки на «Полосах» в «Категориях».
 *
 * Суммы — из расчёта раздела «Бюджет» (`budgetPlanRows`), здесь только разбор
 * по строкам таблицы: категория целиком, подкатегория и траты категории без
 * подкатегории.
 */

import type { BudgetMonthRow } from "./budgetMonth";
import { joinCategoryFull } from "./ruleEngine";
import { sumMoney } from "./money";

export interface CategoryPlan {
  /** Вся категория: с замком — заданная сумма, без него — своя плюс подкатегории. */
  cat: Map<string, number>;
  /** Подкатегория, ключ — полное имя «Категория / Подкатегория». */
  sub: Map<string, number>;
  /** Своя сумма категории — для строки её трат без подкатегории. */
  own: Map<string, number>;
}

export function buildCategoryPlan(
  rows: readonly BudgetMonthRow[],
  kind: "expense" | "income"
): CategoryPlan {
  const groups = new Map<string, { parent: BudgetMonthRow | null; subs: BudgetMonthRow[] }>();
  for (const r of rows) {
    if (r.line.kind !== kind || r.planGroup || r.opening || r.unplanned || r.planned === 0) continue;
    let g = groups.get(r.line.category);
    if (!g) {
      g = { parent: null, subs: [] };
      groups.set(r.line.category, g);
    }
    if (r.line.subcategory) g.subs.push(r);
    else g.parent = r;
  }

  const out: CategoryPlan = { cat: new Map(), sub: new Map(), own: new Map() };
  for (const [category, { parent, subs }] of groups) {
    const locked = !!parent?.locked && parent.planned > 0;
    // Отрицательная своя сумма — поправка Дзен-мани к сумме подкатегорий.
    const whole = locked
      ? parent.planned
      : sumMoney([parent?.planned ?? 0, ...subs.map((s) => s.planned)]);
    if (whole > 0) out.cat.set(category, whole);
    for (const s of subs) {
      if (s.planned > 0) out.sub.set(joinCategoryFull(category, s.line.subcategory ?? null), s.planned);
    }
    // Под замком отдельной своей суммы нет: она уже вся — на категории.
    if (parent && !locked && parent.planned > 0) out.own.set(category, parent.planned);
  }
  return out;
}
