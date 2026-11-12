/**
 * От какой версии сделана правка операции.
 *
 * Правка лежит в очереди, пока не уйдёт в Дзен-мани, и всё это время
 * накладывается поверх данных облака. Без метки версии изменение того же поля
 * с телефона, пришедшее обычной синхронизацией, молча перекрывалось более
 * старой правкой отсюда — и потом уезжало обратно в облако, затирая телефон.
 *
 * Для каждого правленого поля помним, каким оно было в облаке, когда его
 * правили (`base`), и когда правили (`at`). Синхронизация привезла другое
 * значение, и операция изменена в облаке позже правки — значит, поле поменяли
 * там, и правка поля снимается: побеждает последнее изменение, как везде в
 * переносе между устройствами.
 *
 * Карта живёт отдельным ключом, как и карта авторов правок: формат самой
 * правки уходит в Дзен-мани.
 */

import type { EditableField, TransactionEdit } from "../store/useEditsStore";
import type { Transaction } from "../types";

export interface FieldBase {
  /** Значение поля в облаке, поверх которого сделана правка. */
  base: unknown;
  /** Когда поле правили здесь, мс. */
  at: number;
}

export type EditBases = Record<string, Partial<Record<EditableField, FieldBase>>>;

/**
 * Поля, которые снимаются только вместе: оставить подкатегорию от правки при
 * категории с телефона — получить операцию, которой нет ни там, ни здесь.
 */
const GROUPS: readonly (readonly EditableField[])[] = [
  ["category", "subcategory", "categoryFull"],
  [
    "kind",
    "amount",
    "currency",
    "account",
    "accountId",
    "accountKey",
    "outcomeAccount",
    "outcomeAccountId",
    "outcomeAccountKey",
    "incomeAccount",
    "incomeAccountId",
    "incomeAccountKey",
    "incomeAmount",
    "incomeCurrency",
  ],
  ["date", "createdAt"],
  ["payee", "brand"],
];

const groupOf = (f: EditableField): readonly EditableField[] => GROUPS.find((g) => g.includes(f)) ?? [f];

const same = (a: unknown, b: unknown) =>
  a === b || ((a ?? "") === "" && (b ?? "") === "") || JSON.stringify(a) === JSON.stringify(b);

/**
 * Запомнить версию для полей патча. Поле, которое уже правили, сохраняет
 * прежнюю версию: правка по-прежнему сделана поверх неё, человек облачного
 * изменения не видел. Время — новое. Операции нет в данных (черновик) —
 * сравнивать не с чем, ничего не пишем.
 */
export function recordBases(
  bases: EditBases,
  id: string,
  patch: TransactionEdit,
  server: Transaction | undefined,
  now: number
): EditBases {
  if (!server) return bases;
  const fields = Object.keys(patch) as EditableField[];
  if (fields.length === 0) return bases;
  const prev = bases[id] ?? {};
  const cur = { ...prev };
  for (const f of fields) cur[f] = { base: prev[f] ? prev[f]!.base : server[f], at: now };
  return { ...bases, [id]: cur };
}

export function forgetBases(bases: EditBases, ids: readonly string[]): EditBases {
  if (!ids.some((id) => bases[id])) return bases;
  const next = { ...bases };
  for (const id of ids) delete next[id];
  return next;
}

/**
 * Какие поля правки устарели: облако их поменяло позже, чем правили здесь.
 * Возвращает поля к снятию — с соседями по группе.
 */
export function staleFields(
  edit: TransactionEdit,
  fieldBases: Partial<Record<EditableField, FieldBase>> | undefined,
  server: Transaction,
  serverChangedMs: number
): EditableField[] {
  if (!fieldBases) return [];
  const out = new Set<EditableField>();
  for (const f of Object.keys(edit) as EditableField[]) {
    const fb = fieldBases[f];
    if (!fb || out.has(f)) continue;
    if (same(server[f], fb.base)) continue; // в облаке это поле не трогали
    if (serverChangedMs <= fb.at) continue; // тронули раньше правки — правка новее
    for (const g of groupOf(f)) if (g in edit) out.add(g);
  }
  return [...out];
}
