/**
 * Кто записал правку — правило или человек.
 *
 * Правила сопоставляются с ИСХОДНЫМИ значениями операции: иначе правило,
 * которое пишет то же поле, по которому ищет, после применения показывало бы
 * ноль совпадений. Но из-за этого правила не видели и того, что человек
 * поправил руками, — а именно этого от них и ждут: «поменял комментарий, и
 * операция стала подходить под правило» (issue #75).
 *
 * Различать помогает эта карта: для каждой операции — список полей, записанных
 * ПРАВИЛАМИ. Всё остальное в слое правок сделано руками. Отсюда два вывода,
 * ради которых всё и затевалось:
 *
 *   • правила сопоставляются с исходником, поверх которого положены ТОЛЬКО
 *     ручные правки;
 *   • автоприменение не трогает поле, которое человек правил руками, — раньше
 *     оно молча переписало бы его при следующей синхронизации.
 *
 * Карта живёт отдельным ключом, а не полем внутри правки: формат правки уходит
 * в Дзен-мани, и лишний ключ в нём — это лишний ключ в отправке.
 */

import type { EditableField, TransactionEdit } from "../store/useEditsStore";

/** Операция → поля, записанные правилами. */
export type EditOrigins = Record<string, EditableField[]>;

/** Пометить поля как записанные ПРАВИЛОМ. */
export function markRuleFields(
  origins: EditOrigins,
  id: string,
  fields: readonly EditableField[]
): EditOrigins {
  if (fields.length === 0) return origins;
  const next = { ...origins };
  next[id] = [...new Set([...(origins[id] ?? []), ...fields])];
  return next;
}

/**
 * Пометить поля как правленные РУКАМИ — то есть убрать их из списка правил.
 *
 * Человек всегда последний: правило записало категорию, а потом её исправили
 * вручную — с этого момента поле его, и правило на него больше не покушается.
 */
export function markUserFields(
  origins: EditOrigins,
  id: string,
  fields: readonly EditableField[]
): EditOrigins {
  const own = origins[id];
  if (!own || own.length === 0 || fields.length === 0) return origins;
  const drop = new Set<string>(fields);
  const rest = own.filter((f) => !drop.has(f));
  const next = { ...origins };
  if (rest.length === 0) delete next[id];
  else next[id] = rest;
  return next;
}

/** Убрать операции, у которых правок больше нет. */
export function forgetOrigins(origins: EditOrigins, ids: readonly string[]): EditOrigins {
  if (ids.length === 0) return origins;
  const next = { ...origins };
  for (const id of ids) delete next[id];
  return next;
}

/**
 * Только ручные правки: то, что правила ЗАПИСАЛИ, из выборки уходит.
 *
 * Именно это кладётся поверх исходных операций перед сопоставлением: правило
 * видит и банковский комментарий, и вашу правку к нему, но не видит того, что
 * само же и написало.
 */
export function userEdits(
  edits: Record<string, TransactionEdit>,
  origins: EditOrigins
): Record<string, TransactionEdit> {
  const out: Record<string, TransactionEdit> = {};
  for (const [id, patch] of Object.entries(edits)) {
    const byRule = origins[id];
    if (!byRule || byRule.length === 0) {
      out[id] = patch;
      continue;
    }
    const rest: TransactionEdit = { ...patch };
    for (const f of byRule) delete rest[f];
    if (Object.keys(rest).length > 0) out[id] = rest;
  }
  return out;
}

/**
 * Поля, которых автоприменению касаться нельзя: их правил человек.
 *
 * Ручной считается всякая правка, не помеченная как правило, — поэтому список
 * строится по самим правкам, а не по карте.
 */
export function handEditedFields(
  edits: Record<string, TransactionEdit>,
  origins: EditOrigins,
  id: string
): Set<string> {
  const patch = edits[id];
  if (!patch) return new Set();
  const byRule = new Set<string>(origins[id] ?? []);
  return new Set(Object.keys(patch).filter((f) => !byRule.has(f)));
}

/**
 * Разовая разметка уже накопленных правок.
 *
 * До этой версии происхождение не хранилось, и понять задним числом, что из
 * правок сделано руками, нечем. Считаем всё записанным правилами: тогда для
 * существующих данных поведение остаётся ровно таким, каким было, — правила
 * сопоставляются с исходником, как и раньше, — а различаться начнут только
 * новые ручные правки.
 */
export function seedOrigins(edits: Record<string, TransactionEdit>): EditOrigins {
  const out: EditOrigins = {};
  for (const [id, patch] of Object.entries(edits)) {
    const fields = Object.keys(patch) as EditableField[];
    if (fields.length > 0) out[id] = fields;
  }
  return out;
}
