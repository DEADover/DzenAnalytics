// Locally-created transactions that haven't been pushed to the cloud yet
// ("черновики" / drafts). Each draft is a fully-formed `ZenTransaction`
// (everything resolved against the live cache at save time: account id,
// instrument id, tag id, merchant id), so pushing it is just adding it to
// the `sendPush` payload — the same primitive the resurrection path uses.
//
// Lifecycle:
//   1. User fills the create form → we build a ZenTransaction with a fresh
//      UUID and `add()` it here (persisted to IDB).
//   2. For display, `draftsToTransactions` forward-maps drafts through the
//      usual `mapZenmoneyDiff`, and `finalize()` appends them to the
//      visible list (deduped by id against cloud truth).
//   3. On push, drafts ride along in `sendPush`; after the server echo the
//      same id lands in the cache, so we `clearMany()` the pushed drafts.
//
// API mode only — a draft needs cloud ids that don't exist in CSV mode.

import { create } from "zustand";
import * as db from "../lib/db";
import type { ZenTransaction } from "../lib/zenmoney";

const KEY = "pendingTransactions";

interface DraftsState {
  /** id → full Zenmoney transaction built locally, not yet pushed. */
  drafts: Record<string, ZenTransaction>;
  loaded: boolean;
  hydrate: () => Promise<void>;
  /** Insert a new draft (id is the transaction's own UUID). */
  add: (tx: ZenTransaction) => Promise<void>;
  /**
   * Добавить пачку разом — импорт из Excel создаёт сотни операций.
   *
   * Поштучный `add` переписывал бы всю карту черновиков в IndexedDB на каждую
   * строку (двести записей на файл в двести строк) и столько же раз дёргал бы
   * подписку автоотправки — то есть двести попыток пуша вместо одной.
   */
  addMany: (txs: ZenTransaction[]) => Promise<void>;
  /** Replace an existing draft in place (same id). */
  update: (tx: ZenTransaction) => Promise<void>;
  /** Drop one draft (user discarded it). */
  remove: (id: string) => Promise<void>;
  /** Drop many drafts at once — used after a successful push. */
  clearMany: (ids: string[]) => Promise<void>;
  clearAll: () => Promise<void>;
}

export const useDraftsStore = create<DraftsState>((set, get) => ({
  drafts: {},
  loaded: false,

  hydrate: async () => {
    const data = await db.loadJSON<Record<string, ZenTransaction>>(KEY);
    set({ drafts: data || {}, loaded: true });
  },

  add: async (tx) => {
    const next = { ...get().drafts, [tx.id]: tx };
    await db.saveJSON(KEY, next);
    set({ drafts: next });
  },

  addMany: async (txs) => {
    if (txs.length === 0) return;
    const next = { ...get().drafts };
    for (const tx of txs) next[tx.id] = tx;
    await db.saveJSON(KEY, next);
    set({ drafts: next });
  },

  update: async (tx) => {
    const next = { ...get().drafts, [tx.id]: tx };
    await db.saveJSON(KEY, next);
    set({ drafts: next });
  },

  remove: async (id) => {
    if (!(id in get().drafts)) return;
    const next = { ...get().drafts };
    delete next[id];
    await db.saveJSON(KEY, next);
    set({ drafts: next });
  },

  clearMany: async (ids) => {
    if (ids.length === 0) return;
    const next = { ...get().drafts };
    let changed = false;
    for (const id of ids) {
      if (id in next) {
        delete next[id];
        changed = true;
      }
    }
    if (!changed) return;
    await db.saveJSON(KEY, next);
    set({ drafts: next });
  },

  clearAll: async () => {
    await db.saveJSON(KEY, {});
    set({ drafts: {} });
  },
}));

/** Read drafts without a hook — for the pipeline / push builder. Prefers
 *  the in-memory copy, falls back to disk before the first hydrate. */
export async function loadDrafts(): Promise<Record<string, ZenTransaction>> {
  const s = useDraftsStore.getState();
  if (s.loaded) return s.drafts;
  const disk = await db.loadJSON<Record<string, ZenTransaction>>(KEY);
  return disk || {};
}
