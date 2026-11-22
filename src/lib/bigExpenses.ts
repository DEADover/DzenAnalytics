/**
 * «Крупные траты месяца»: самые большие расходные операции и какая доля
 * расходов месяца на них пришлась.
 *
 * Берём операции, а не категории: виджет отвечает на вопрос «на что ушли
 * большие деньги», и ответ на него — конкретный платёж. Возвраты и переводы в
 * список не входят. Доля — от суммы расходных операций до вычета возвратов,
 * чтобы она никогда не выходила за 100%.
 */

import type { Transaction } from "../types";

export interface BigExpenseRow {
  tx: Transaction;
  /** Доля этой операции в расходах месяца, 0…1. */
  share: number;
}

export interface BigExpenses {
  rows: BigExpenseRow[];
  /** Сумма показанных операций. */
  topSum: number;
  /** Какая доля расходов месяца пришлась на показанные операции. */
  topShare: number;
  /** Сколько всего расходных операций в месяце. */
  count: number;
}

export const BIG_EXPENSES_LIMIT = 5;

export function buildBigExpenses(
  txs: readonly Transaction[],
  limit: number = BIG_EXPENSES_LIMIT
): BigExpenses {
  const expenses = txs.filter((t) => t.kind === "expense" && t.amountBase > 0);
  const total = expenses.reduce((s, t) => s + t.amountBase, 0);
  const top = [...expenses]
    // При равной сумме выше та, что случилась позже.
    .sort((a, b) => b.amountBase - a.amountBase || b.date.localeCompare(a.date))
    .slice(0, limit);
  const topSum = top.reduce((s, t) => s + t.amountBase, 0);
  return {
    rows: top.map((tx) => ({ tx, share: total > 0 ? tx.amountBase / total : 0 })),
    topSum,
    topShare: total > 0 ? topSum / total : 0,
    count: expenses.length,
  };
}
