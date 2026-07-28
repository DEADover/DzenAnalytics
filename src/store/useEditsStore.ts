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

interface EditsState {
  edits: Record<string, TransactionEdit>;
  loaded: boolean;
  hydrate: () => Promise<void>;
  setEdit: (id: string, patch: TransactionEdit) => Promise<void>;
  /** Apply the same patch to many transactions at once — one IDB write
   *  + one store update (so the pipeline re-runs / auto-push fires once,
   *  not N times). */
  setEditMany: (ids: string[], patch: TransactionEdit) => Promise<void>;
  /** Apply a DIFFERENT patch per transaction — one IDB write + one store
   *  update. Used by bulk «Дополнить комментарий», where each row gets its
   *  own merged comment. Atomic, so no sequential-write race. */
  setEditEach: (patches: Record<string, TransactionEdit>) => Promise<void>;
  clearEdit: (id: string) => Promise<void>;
  /** Drop many edits at once (one IDB write). Used to prune orphaned edits —
   *  overrides whose transaction no longer exists in the dataset (e.g. after
   *  switching CSV → API, where ids change), so they can neither apply nor push. */
  clearMany: (ids: string[]) => Promise<void>;
  clearAll: () => Promise<void>;
}

const KEY = "transactionEdits";

export const useEditsStore = create<EditsState>((set, get) => ({
  edits: {},
  loaded: false,

  hydrate: async () => {
    const data = await db.loadJSON<Record<string, TransactionEdit>>(KEY);
    set({ edits: data || {}, loaded: true });
  },

  setEdit: async (id, patch) => {
    const next = { ...get().edits, [id]: { ...get().edits[id], ...patch } };
    await db.saveJSON(KEY, next);
    set({ edits: next });
  },

  setEditMany: async (ids, patch) => {
    if (ids.length === 0) return;
    const prev = get().edits;
    const next = { ...prev };
    for (const id of ids) {
      next[id] = { ...prev[id], ...patch };
    }
    await db.saveJSON(KEY, next);
    set({ edits: next });
  },

  setEditEach: async (patches) => {
    const ids = Object.keys(patches);
    if (ids.length === 0) return;
    const prev = get().edits;
    const next = { ...prev };
    for (const id of ids) {
      next[id] = { ...prev[id], ...patches[id] };
    }
    await db.saveJSON(KEY, next);
    set({ edits: next });
  },

  clearEdit: async (id) => {
    const next = { ...get().edits };
    delete next[id];
    await db.saveJSON(KEY, next);
    set({ edits: next });
  },

  clearMany: async (ids) => {
    if (ids.length === 0) return;
    const next = { ...get().edits };
    for (const id of ids) delete next[id];
    await db.saveJSON(KEY, next);
    set({ edits: next });
  },

  clearAll: async () => {
    await db.saveJSON(KEY, {});
    set({ edits: {} });
  },
}));
