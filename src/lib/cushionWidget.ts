/**
 * «Подушка безопасности» на главной. Сам расчёт — показатель «Финансового
 * здоровья» (`lib/health`), чтобы числа в виджете и в разделе совпадали; здесь
 * только то, что нужно показать.
 */

import type { HealthComponent } from "./health";

export interface CushionView {
  /** На сколько месяцев обычных расходов хватит накоплений. */
  months: number;
  /** Цель, месяцев. */
  target: number;
  /** Доля цели, 0…1. */
  ratio: number;
  liquid: number;
  avgExpense: number;
  /** Сколько не хватает до цели; 0 — цель достигнута. */
  toTarget: number;
  /**
   * На сколько хватит, если оставить только обязательные траты. `null`, если
   * выходит то же число: категории обязательны, пока их не отметили иначе, и
   * строка с повтором ничего бы не сказала.
   */
  obligatoryMonths: number | null;
}

export function cushionView(c: HealthComponent | undefined): CushionView | null {
  if (!c || c.status === "na" || !c.facts) return null;
  const { liquid, avgExpense, target } = c.facts as { liquid: number; avgExpense: number; target: number };
  if (!(avgExpense > 0) || !(target > 0)) return null;
  const months = Math.max(0, liquid / avgExpense);
  const obligatory = c.extra?.obligatoryMonths ?? null;
  const sameAsAll = obligatory !== null && Math.round(obligatory * 10) === Math.round(months * 10);
  return {
    months,
    target,
    ratio: Math.min(1, months / target),
    liquid,
    avgExpense,
    toTarget: Math.max(0, target * avgExpense - liquid),
    obligatoryMonths: sameAsAll ? null : obligatory,
  };
}
