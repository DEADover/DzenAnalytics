import type { Transaction } from "../types";

/**
 * Вернуть получателям текст из Дзен-мани (или CSV).
 *
 * До 1.25.1 была «Группировка получателей»: она склеивала похожие имена и
 * записывала склеенное прямо в сохранённую ленту. Её убрали — эту задачу
 * решает справочник контрагентов, — а у тех, кто её включал, ленту при
 * открытии один раз приводим к исходным именам.
 */
export function restoreOriginalPayees(txs: Transaction[]): { txs: Transaction[]; changed: boolean } {
  let changed = false;
  const out = txs.map((t) => {
    if (t.payeeOriginal === undefined || t.payee === t.payeeOriginal) return t;
    changed = true;
    return { ...t, payee: t.payeeOriginal };
  });
  return { txs: changed ? out : txs, changed };
}

/** Ключи бывшей «Группировки получателей» — стираются при первом открытии. */
export const LEGACY_PAYEE_KEYS = ["payeeGrouping", "payeeAliases"];
