import type { TxKind } from "../types";

/**
 * Semantic validation for an operation about to be created/edited — pure so it
 * can be unit-tested and reused. Mirrors (and is the single source of truth for)
 * the inline checks the EditTransactionModal runs BEFORE persisting, so the user
 * gets an immediate error instead of a silent push-time skip that strands the
 * change in «зависшие» (issue #19: 2, 7, 8).
 *
 * All string fields are expected pre-trimmed by the caller. `amount` is the
 * parsed number. Returns a human-readable error, or null when the op is valid.
 */
export interface OperationInput {
  kind: TxKind;
  /** Debt-editor mode (kind is "transfer" underneath). */
  isDebt: boolean;
  amount: number;
  /** Counterparty / «Плательщик» (required for a debt op). */
  payee: string;
  /** Debt: the real (non-debt) account. */
  realAcc: string;
  /** Transfer: source / destination account titles. */
  outAcc: string;
  inAcc: string;
  /** income/expense/refund category title ("" = «Без категории»). */
  category: string;
  /** True when the chosen category is income-capable (tag `showIncome`) — a
   *  refund must target an EXPENSE-only category, never a dual one. */
  categoryHasIncome: boolean;
  /**
   * Категория известна как ТОЛЬКО расходная (у тега `showOutcome` без
   * `showIncome`). Необязательно: без справочника Дзен-мани (CSV) это
   * неизвестно, и проверка молчит.
   */
  categoryExpenseOnly?: boolean;
}

/** Synthetic local categories that have no real Zenmoney tag. */
const SYNTHETIC = new Set(["Перевод", "Долг"]);

export function validateOperation(o: OperationInput): string | null {
  if (!(o.amount > 0)) return "Сумма должна быть больше нуля.";

  if (o.isDebt) {
    if (!o.payee) return "Укажите плательщика (контрагента) для долговой операции.";
    if (!o.realAcc) return "Выберите счёт для долговой операции.";
    return null;
  }

  if (o.kind === "transfer") {
    if (!o.outAcc || !o.inAcc) return "Выберите оба счёта перевода.";
    if (o.outAcc === o.inAcc) return "Перевод нельзя сделать на тот же счёт.";
    return null;
  }

  // income / expense / refund
  if (SYNTHETIC.has(o.category)) {
    return `«${o.category}» — служебная категория. Выберите реальную категорию или «Без категории».`;
  }
  if (o.kind === "refund" && o.category && o.categoryHasIncome) {
    return "Возврат возможен только по расходной категории.";
  }
  // Зеркало правила выше. Отдельного признака «возврат» у Дзен-мани нет:
  // приход по расходной категории он сам записывает возвратом. Сменить тип с
  // «Возврата» на «Доход», оставив категорию, значило сохранить то же самое —
  // и после синхронизации операция снова становилась возвратом.
  if (o.kind === "income" && o.category && o.categoryExpenseOnly) {
    return "Доход возможен только по доходной категории: по расходной Дзен-мани запишет его возвратом. Выберите доходную категорию или «Без категории».";
  }
  return null;
}
