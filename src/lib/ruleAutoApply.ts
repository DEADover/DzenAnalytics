import type { Transaction } from "../types";
import type { TransactionEdit } from "../store/useEditsStore";
import { migrateRule, type StoredRule } from "./ruleEngine";
import { buildRulePlan } from "./rulePlan";
import { handEditedFields, type EditOrigins } from "./editOrigins";

/**
 * Автоприменение: что правила с включённой галочкой сделают с операциями,
 * которых раньше не было.
 *
 * Считает тот же `buildRulePlan`, что и окно «Проверить и применить», — иначе
 * автоматическая и ручная запись однажды разошлись бы в том, что именно
 * записывают. Отсюда же берутся и все его проверки: операция с категорией,
 * которой нет в справочнике Дзен-мани, и правило, ссылающееся на исчезнувшего
 * контрагента, не записываются ни вручную, ни сами.
 *
 * Применяется ТОЛЬКО к переданным операциям — вызывающий отбирает новые. К уже
 * имеющимся автоприменение не лезет никогда: галочка в таблице правил не должна
 * молча переписать историю.
 */
export function autoApplyPatches(
  fresh: Transaction[],
  rules: StoredRule[],
  edits: Record<string, TransactionEdit>,
  deletedSet: Set<string>,
  categoryOk: ((category: string, subcategory: string | null) => boolean) | null,
  payeeOk: ((title: string) => boolean) | null = null,
  /** Чем записано то, что уже лежит в правках, — см. `editOrigins`. */
  origins: EditOrigins = {}
): Record<string, TransactionEdit> {
  if (fresh.length === 0) return {};
  const auto = rules.filter((r) => {
    const v2 = migrateRule(r);
    return v2.enabled && v2.autoApply === true;
  });
  if (auto.length === 0) return {};

  const plan = buildRulePlan(
    fresh,
    auto,
    new Set(auto.map((r) => r.id)),
    edits,
    deletedSet,
    categoryOk,
    payeeOk
  );

  const patches: Record<string, TransactionEdit> = {};
  for (const row of plan.pending) {
    // Поле, которое человек правил РУКАМИ, автоприменение не трогает: правило
    // может ошибаться, человек — решает. Вручную то же самое по-прежнему можно
    // записать кнопкой: там список изменений на глазах.
    const hand = handEditedFields(edits, origins, row.tx.id);
    if (hand.size === 0) {
      patches[row.tx.id] = row.patch;
      continue;
    }
    const kept = Object.fromEntries(
      Object.entries(row.patch).filter(([field]) => !hand.has(field))
    ) as TransactionEdit;
    if (Object.keys(kept).length > 0) patches[row.tx.id] = kept;
  }
  return patches;
}
