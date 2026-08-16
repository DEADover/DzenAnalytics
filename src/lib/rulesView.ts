/**
 * Операции такими, какими их видят правила.
 *
 * Правила сопоставляются с ИСХОДНИКОМ — тем, что пришло из банка, — и это
 * правильно: иначе правило, которое пишет то же поле, по которому ищет, после
 * применения показало бы ноль совпадений, и счётчики схлопнулись бы.
 *
 * Но исходник — это ещё не вся правда. Если человек сам поправил комментарий
 * или получателя, операция должна начать подходить под правило: ровно этот
 * случай описан в issue #75 («пришло с комментарием „Прочие поступления“,
 * поменял на свой — правило должно сработать»). Поэтому поверх исходника
 * кладутся РУЧНЫЕ правки — и только они; что записало само правило, отсюда
 * убрано (см. `editOrigins`).
 *
 * Меняются только поля, по которым правило умеет искать. Суммы, даты и всё
 * остальное берутся из исходника: пересчитывать их ради сопоставления незачем.
 */

import type { Transaction } from "../types";
import type { TransactionEdit } from "../store/useEditsStore";

/** Поля, которые участвуют в условиях правил. */
const MATCH_FIELDS = [
  "category",
  "subcategory",
  "categoryFull",
  "payee",
  "brand",
  "comment",
  "account",
  "outcomeAccount",
  "incomeAccount",
] as const;

type MatchField = (typeof MATCH_FIELDS)[number];

export function rulesView(
  raw: Transaction[],
  edits: Record<string, TransactionEdit>
): Transaction[] {
  if (raw.length === 0 || Object.keys(edits).length === 0) return raw;
  return raw.map((t) => {
    const patch = edits[t.id];
    if (!patch) return t;
    let next: Transaction | null = null;
    for (const f of MATCH_FIELDS) {
      const v = patch[f as MatchField];
      if (v === undefined) continue;
      if (!next) next = { ...t };
      // Значения полей — строки или null; шире их тип не бывает, поэтому
      // присваивание безопасно и без разбора каждого поля по отдельности.
      (next as unknown as Record<string, unknown>)[f] = v;
    }
    return next ?? t;
  });
}
