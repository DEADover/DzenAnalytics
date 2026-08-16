// Per-transaction local overrides. The overlay is applied AFTER all
// canonical post-processing (payee grouping, category rules), so user
// edits "win" against everything else.
//
// In CSV mode they are the only way to fix anything. In API mode they
// survive subsequent diffs (the mapper produces a fresh Transaction
// from server data, the overlay re-applies on top). Push-to-Zenmoney
// is intentionally NOT implemented here — it's a separate feature.

import { create } from "zustand";
import * as db from "../lib/db";
import type { Transaction } from "../types";
import {
  forgetOrigins,
  markRuleFields,
  markUserFields,
  seedOrigins,
  type EditOrigins,
} from "../lib/editOrigins";

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
  | "unseen";

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
}

const KEY = "transactionEdits";
const ORIGINS_KEY = "transactionEditOrigins";

/** Записать правки и карту происхождения одним заходом. */
async function persist(
  edits: Record<string, TransactionEdit>,
  origins: EditOrigins
): Promise<void> {
  await Promise.all([db.saveJSON(KEY, edits), db.saveJSON(ORIGINS_KEY, origins)]);
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

export const useEditsStore = create<EditsState>((set, get) => ({
  edits: {},
  origins: {},
  loaded: false,

  hydrate: async () => {
    const [data, saved] = await Promise.all([
      db.loadJSON<Record<string, TransactionEdit>>(KEY),
      db.loadJSON<EditOrigins>(ORIGINS_KEY),
    ]);
    const edits = data || {};
    // Карты ещё нет — размечаем накопленное как записанное правилами: так для
    // существующих данных ничего не меняется (см. `seedOrigins`).
    const origins = saved ?? seedOrigins(edits);
    if (!saved && Object.keys(origins).length > 0) await db.saveJSON(ORIGINS_KEY, origins);
    set({ edits, origins, loaded: true });
  },

  setEdit: async (id, patch, origin = "user") => {
    const next = { ...get().edits, [id]: { ...get().edits[id], ...patch } };
    const origins = trace(get().origins, id, patch, origin);
    await persist(next, origins);
    set({ edits: next, origins });
  },

  setEditMany: async (ids, patch, origin = "user") => {
    if (ids.length === 0) return;
    const prev = get().edits;
    const next = { ...prev };
    let origins = get().origins;
    for (const id of ids) {
      next[id] = { ...prev[id], ...patch };
      origins = trace(origins, id, patch, origin);
    }
    await persist(next, origins);
    set({ edits: next, origins });
  },

  setEditEach: async (patches, origin = "user") => {
    const ids = Object.keys(patches);
    if (ids.length === 0) return;
    const prev = get().edits;
    const next = { ...prev };
    let origins = get().origins;
    for (const id of ids) {
      next[id] = { ...prev[id], ...patches[id] };
      origins = trace(origins, id, patches[id], origin);
    }
    await persist(next, origins);
    set({ edits: next, origins });
  },

  clearEdit: async (id) => {
    const next = { ...get().edits };
    delete next[id];
    const origins = forgetOrigins(get().origins, [id]);
    await persist(next, origins);
    set({ edits: next, origins });
  },

  clearMany: async (ids) => {
    if (ids.length === 0) return;
    const next = { ...get().edits };
    for (const id of ids) delete next[id];
    const origins = forgetOrigins(get().origins, ids);
    await persist(next, origins);
    set({ edits: next, origins });
  },

  clearAll: async () => {
    await persist({}, {});
    set({ edits: {}, origins: {} });
  },
}));
