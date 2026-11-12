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
import { serialQueue } from "../lib/serialQueue";
import type { ZenTransaction } from "../lib/zenmoney";

const KEY = "pendingTransactions";
const RESEND_KEY = "pendingTransactionsResend";

interface DraftsState {
  /** id → full Zenmoney transaction built locally, not yet pushed. */
  drafts: Record<string, ZenTransaction>;
  /**
   * Черновики, которые поправили, пока они ехали в облако: там уже лежит
   * прежняя версия под тем же id. Такой черновик не «уже отправлен» — его
   * нужно отправить ещё раз, и до тех пор на экране главный он, а не облако.
   */
  resend: ReadonlySet<string>;
  loaded: boolean;
  hydrate: () => Promise<void>;
  /** Пометить черновики для повторной отправки (см. `resend`). */
  markResend: (ids: string[]) => Promise<void>;
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

/** Действия по одному — без гонки «прочитал → записал» (lib/serialQueue). */
const queue = serialQueue();

export const useDraftsStore = create<DraftsState>((set, get) => {
  /** Пометки живут только у существующих черновиков. */
  async function dropResend(ids: readonly string[]) {
    const cur = get().resend;
    if (!ids.some((id) => cur.has(id))) return;
    const next = new Set(cur);
    for (const id of ids) next.delete(id);
    await db.saveJSON(RESEND_KEY, [...next]);
    set({ resend: next });
  }

  return {
  drafts: {},
  resend: new Set<string>(),
  loaded: false,

  hydrate: () => queue(async () => {
    const data = (await db.loadJSON<Record<string, ZenTransaction>>(KEY)) || {};
    const marks = (await db.loadJSON<string[]>(RESEND_KEY)) || [];
    set({ drafts: data, resend: new Set(marks.filter((id) => id in data)), loaded: true });
  }),

  markResend: (ids) => queue(async () => {
    const fresh = ids.filter((id) => id in get().drafts && !get().resend.has(id));
    if (fresh.length === 0) return;
    const next = new Set([...get().resend, ...fresh]);
    await db.saveJSON(RESEND_KEY, [...next]);
    set({ resend: next });
  }),

  add: (tx) => queue(async () => {
    const next = { ...get().drafts, [tx.id]: tx };
    await db.saveJSON(KEY, next);
    set({ drafts: next });
  }),

  addMany: (txs) => queue(async () => {
    if (txs.length === 0) return;
    const next = { ...get().drafts };
    for (const tx of txs) next[tx.id] = tx;
    await db.saveJSON(KEY, next);
    set({ drafts: next });
  }),

  update: (tx) => queue(async () => {
    const next = { ...get().drafts, [tx.id]: tx };
    await db.saveJSON(KEY, next);
    set({ drafts: next });
  }),

  remove: (id) => queue(async () => {
    if (!(id in get().drafts)) return;
    const next = { ...get().drafts };
    delete next[id];
    await db.saveJSON(KEY, next);
    set({ drafts: next });
    await dropResend([id]);
  }),

  clearMany: (ids) => queue(async () => {
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
    await dropResend(ids);
  }),

  clearAll: () => queue(async () => {
    await db.saveJSON(KEY, {});
    await db.saveJSON(RESEND_KEY, []);
    set({ drafts: {}, resend: new Set<string>() });
  }),
  };
});

/** Read drafts without a hook — for the pipeline / push builder. Prefers
 *  the in-memory copy, falls back to disk before the first hydrate. */
export async function loadDrafts(): Promise<Record<string, ZenTransaction>> {
  const s = useDraftsStore.getState();
  if (s.loaded) return s.drafts;
  const disk = await db.loadJSON<Record<string, ZenTransaction>>(KEY);
  return disk || {};
}
