// Per-transaction local overrides. The overlay is applied AFTER all
// canonical post-processing (rates, category rules), so user
// edits "win" against everything else.
//
// In CSV mode they are the only way to fix anything. In API mode they
// survive subsequent diffs (the mapper produces a fresh Transaction
// from server data, the overlay re-applies on top). Push-to-Zenmoney
// is intentionally NOT implemented here — it's a separate feature.

import { create } from "zustand";
import * as db from "../lib/db";
import { serialQueue } from "../lib/serialQueue";
import type { Transaction } from "../types";
import {
  forgetOrigins,
  markRuleFields,
  markUserFields,
  seedOrigins,
  type EditOrigins,
} from "../lib/editOrigins";
import { forgetBases, recordBases, staleFields, type EditBases } from "../lib/editBases";

// Whitelisted editable fields. Keeping it explicit avoids accidentally
// stomping derived fields like `amountBase` (we recompute that ourselves).
export type EditableField =
  | "date"
  // Operation timestamp (ISO). Edited via the «Время» field — Zenmoney has no
  // separate time column, so the time-of-day lives in `created`/`createdAt`.
  | "createdAt"
  | "category"
  | "subcategory"
  | "categoryFull"
  | "payee"
  // Zenmoney-curated brand (separate from raw payee). Lets the user
  // override or set a brand when working with API data, and provides
  // a way to attach brands manually on CSV imports.
  | "brand"
  | "comment"
  | "amount"
  | "currency"
  | "account"
  // Номера счетов к названиям выше — по ним правка уходит в Дзен-мани:
  // у двух счетов может быть одно название.
  | "accountId"
  | "outcomeAccountId"
  | "incomeAccountId"
  | "accountKey"
  | "outcomeAccountKey"
  | "incomeAccountKey"
  // Transfer-aware fields. Editing `kind` lets the user fix
  | "kind"
  // misclassified expense/income/transfer rows; the two side-fields
  | "outcomeAccount"
  // are required to keep both legs of a transfer in sync.
  | "incomeAccount"
  // Destination-leg amount/currency — only meaningful for a cross-currency
  // transfer, where the two legs hold different sums in their own currencies.
  | "incomeAmount"
  | "incomeCurrency"
  // Снятие пометки «новая»: в Дзен-мани это поле `viewed`. Держим его здесь,
  // а не отдельным хранилищем, чтобы отметка ехала в облако тем же путём, что
  // и обычная правка, и так же откатывалась построчно.
  | "unseen"
  // Вторая и следующие категории (#69). Правятся в карточке операции, когда
  // теги ведутся категориями, и уезжают в Дзен-мани следом за основной.
  | "extraCategories";

export type TransactionEdit = Partial<Pick<Transaction, EditableField>>;

/**
 * Кто пишет правку. По умолчанию — человек: руками правят из десятка мест, а
 * правила ровно из двух, и явную пометку проще требовать от них.
 */
export type EditOrigin = "user" | "rule";

interface EditsState {
  edits: Record<string, TransactionEdit>;
  /** Поля, записанные правилами (см. `lib/editOrigins`). */
  origins: EditOrigins;
  /** От какой версии облака сделана каждая правка (см. `lib/editBases`). */
  bases: EditBases;
  loaded: boolean;
  hydrate: () => Promise<void>;
  setEdit: (id: string, patch: TransactionEdit, origin?: EditOrigin) => Promise<void>;
  /** Apply the same patch to many transactions at once — one IDB write
   *  + one store update (so the pipeline re-runs / auto-push fires once,
   *  not N times). */
  setEditMany: (ids: string[], patch: TransactionEdit, origin?: EditOrigin) => Promise<void>;
  /** Apply a DIFFERENT patch per transaction — one IDB write + one store
   *  update. Used by bulk «Дополнить комментарий», where each row gets its
   *  own merged comment. Atomic, so no sequential-write race. */
  setEditEach: (
    patches: Record<string, TransactionEdit>,
    origin?: EditOrigin
  ) => Promise<void>;
  clearEdit: (id: string) => Promise<void>;
  /** Drop many edits at once (one IDB write). Used to prune orphaned edits —
   *  overrides whose transaction no longer exists in the dataset (e.g. after
   *  switching CSV → API, where ids change), so they can neither apply nor push. */
  clearMany: (ids: string[]) => Promise<void>;
  clearAll: () => Promise<void>;
  /** Снимок правок и их авторов — чтобы потом вернуть ровно как было. */
  snapshot: (ids: readonly string[]) => EditsSnapshot;
  /** Вернуть правки этих операций к снимку: была правка — она, не было — никакой. */
  restore: (snap: EditsSnapshot) => Promise<void>;
  /**
   * Синхронизация привезла операции `changed` (id → когда изменены в облаке,
   * мс). Поля правок, которые облако поменяло позже, снимаются. `serverOf` —
   * операция в том виде, в каком она пришла (без правок). Возвращает, сколько
   * полей снято.
   */
  settleWithServer: (
    changed: ReadonlyMap<string, number>,
    serverOf: (id: string) => Transaction | undefined
  ) => Promise<number>;
}

export interface EditsSnapshot {
  edits: Record<string, TransactionEdit | undefined>;
  origins: Record<string, EditableField[] | undefined>;
  bases: EditBases;
}

const KEY = "transactionEdits";
const ORIGINS_KEY = "transactionEditOrigins";
const BASES_KEY = "transactionEditBases";

/** Ключи, под которыми лежит очередь правок: для снимков, вкладок и бэкапа. */
export const EDIT_STORE_KEYS = [KEY, ORIGINS_KEY, BASES_KEY] as const;

/**
 * Операции, поверх которых кладутся правки, — без самих правок. Задаёт стор
 * данных (он импортирует этот, а не наоборот).
 */
let serverLookup: () => (id: string) => Transaction | undefined = () => () => undefined;
export function setEditBaseSource(fn: () => (id: string) => Transaction | undefined): void {
  serverLookup = fn;
}

/** Записать правки, карту происхождения и версии одним заходом. */
async function persist(
  edits: Record<string, TransactionEdit>,
  origins: EditOrigins,
  bases: EditBases
): Promise<void> {
  await Promise.all([db.saveJSON(KEY, edits), db.saveJSON(ORIGINS_KEY, origins), db.saveJSON(BASES_KEY, bases)]);
}

/** Разметить поля патча по автору. */
function trace(
  origins: EditOrigins,
  id: string,
  patch: TransactionEdit,
  origin: EditOrigin
): EditOrigins {
  const fields = Object.keys(patch) as EditableField[];
  return origin === "rule"
    ? markRuleFields(origins, id, fields)
    : markUserFields(origins, id, fields);
}

/** Действия по одному — без гонки «прочитал → записал» (lib/serialQueue). */
const queue = serialQueue();

export const useEditsStore = create<EditsState>((set, get) => ({
  edits: {},
  origins: {},
  bases: {},
  loaded: false,

  hydrate: () => queue(async () => {
    const [data, saved, bases] = await Promise.all([
      db.loadJSON<Record<string, TransactionEdit>>(KEY),
      db.loadJSON<EditOrigins>(ORIGINS_KEY),
      db.loadJSON<EditBases>(BASES_KEY),
    ]);
    const edits = data || {};
    // Карты ещё нет — размечаем накопленное как записанное правилами: так для
    // существующих данных ничего не меняется (см. `seedOrigins`).
    const origins = saved ?? seedOrigins(edits);
    if (!saved && Object.keys(origins).length > 0) await db.saveJSON(ORIGINS_KEY, origins);
    // Правки, сделанные до меток версии, меток не имеют — они, как и раньше,
    // накладываются поверх облака.
    set({ edits, origins, bases: bases ?? {}, loaded: true });
  }),

  setEdit: (id, patch, origin = "user") => queue(async () => {
    const next = { ...get().edits, [id]: { ...get().edits[id], ...patch } };
    const origins = trace(get().origins, id, patch, origin);
    const bases = recordBases(get().bases, id, patch, serverLookup()(id), Date.now());
    await persist(next, origins, bases);
    set({ edits: next, origins, bases });
  }),

  setEditMany: (ids, patch, origin = "user") => queue(async () => {
    if (ids.length === 0) return;
    const prev = get().edits;
    const next = { ...prev };
    let origins = get().origins;
    let bases = get().bases;
    const serverOf = serverLookup();
    const now = Date.now();
    for (const id of ids) {
      next[id] = { ...prev[id], ...patch };
      origins = trace(origins, id, patch, origin);
      bases = recordBases(bases, id, patch, serverOf(id), now);
    }
    await persist(next, origins, bases);
    set({ edits: next, origins, bases });
  }),

  setEditEach: (patches, origin = "user") => queue(async () => {
    const ids = Object.keys(patches);
    if (ids.length === 0) return;
    const prev = get().edits;
    const next = { ...prev };
    let origins = get().origins;
    let bases = get().bases;
    const serverOf = serverLookup();
    const now = Date.now();
    for (const id of ids) {
      next[id] = { ...prev[id], ...patches[id] };
      origins = trace(origins, id, patches[id], origin);
      bases = recordBases(bases, id, patches[id], serverOf(id), now);
    }
    await persist(next, origins, bases);
    set({ edits: next, origins, bases });
  }),

  clearEdit: (id) => queue(async () => {
    const next = { ...get().edits };
    delete next[id];
    const origins = forgetOrigins(get().origins, [id]);
    const bases = forgetBases(get().bases, [id]);
    await persist(next, origins, bases);
    set({ edits: next, origins, bases });
  }),

  clearMany: (ids) => queue(async () => {
    if (ids.length === 0) return;
    const next = { ...get().edits };
    for (const id of ids) delete next[id];
    const origins = forgetOrigins(get().origins, ids);
    const bases = forgetBases(get().bases, ids);
    await persist(next, origins, bases);
    set({ edits: next, origins, bases });
  }),

  clearAll: () => queue(async () => {
    await persist({}, {}, {});
    set({ edits: {}, origins: {}, bases: {} });
  }),

  snapshot: (ids) => {
    const { edits, origins, bases } = get();
    const snap: EditsSnapshot = { edits: {}, origins: {}, bases: {} };
    for (const id of ids) {
      snap.edits[id] = edits[id] ? { ...edits[id] } : undefined;
      snap.origins[id] = origins[id] ? [...origins[id]] : undefined;
      if (bases[id]) snap.bases[id] = { ...bases[id] };
    }
    return snap;
  },

  restore: (snap) => queue(async () => {
    const edits = { ...get().edits };
    const origins = { ...get().origins };
    const bases = { ...get().bases };
    for (const id of Object.keys(snap.edits)) {
      const e = snap.edits[id];
      if (e) edits[id] = e;
      else delete edits[id];
      const o = snap.origins[id];
      if (o) origins[id] = o;
      else delete origins[id];
      const b = snap.bases?.[id];
      if (b) bases[id] = b;
      else delete bases[id];
    }
    await persist(edits, origins, bases);
    set({ edits, origins, bases });
  }),

  settleWithServer: (changed, serverOf) => queue(async () => {
    const { edits, origins, bases } = get();
    let nextEdits: Record<string, TransactionEdit> | null = null;
    let nextBases: EditBases | null = null;
    let dropped = 0;
    for (const [id, at] of changed) {
      const edit = edits[id];
      const server = edit && bases[id] ? serverOf(id) : undefined;
      if (!edit || !server) continue;
      const stale = staleFields(edit, bases[id], server, at);
      if (stale.length === 0) continue;
      nextEdits ??= { ...edits };
      nextBases ??= { ...bases };
      const keep = { ...edit };
      const keepBase = { ...bases[id] };
      for (const f of stale) {
        delete keep[f];
        delete keepBase[f];
      }
      dropped += stale.length;
      if (Object.keys(keep).length === 0) {
        delete nextEdits[id];
        delete nextBases[id];
      } else {
        nextEdits[id] = keep;
        nextBases[id] = keepBase;
      }
    }
    if (!nextEdits || !nextBases) return 0;
    // Автор правки — только для оставшихся полей; карта и так терпит лишнее,
    // но снятую целиком операцию из неё убираем.
    const gone = Object.keys(edits).filter((id) => !nextEdits![id]);
    const nextOrigins = forgetOrigins(origins, gone);
    await persist(nextEdits, nextOrigins, nextBases);
    set({ edits: nextEdits, origins: nextOrigins, bases: nextBases });
    return dropped;
  }),
}));
