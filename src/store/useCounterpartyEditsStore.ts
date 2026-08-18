// Pending changes to контрагенты (Zenmoney merchants) — the dictionary behind
// «Получатель» on an operation. A merchant is a trivial {id, user, title,
// changed} row, so the local overlay only needs three buckets:
//
//   • renames  — id → new title (existing cached merchant)
//   • created  — brand-new rows with a client-minted uuid
//   • deleted  — ids to remove (ride the generic ZenDeletion channel)
//   • merges   — duplicate id → survivor id; the operations move over first,
//                then the duplicate is deleted (see buildMerchantMergePush)
//
// Everything is persisted to IDB and flushed through the normal Push flow, then
// cleared per-id on success (the rows come back from the cloud on next sync).

import { create } from "zustand";
import * as db from "../lib/db";

export interface NewCounterparty {
  /** Fresh client-minted uuid — becomes the Zenmoney merchant id on push. */
  id: string;
  title: string;
}

interface Persisted {
  renames: Record<string, string>;
  created: NewCounterparty[];
  deleted: string[];
  /** Duplicate merchant id → the id that keeps the operations. */
  merges: Record<string, string>;
}

const KEY = "counterpartyEdits";

interface State extends Persisted {
  loaded: boolean;
  hydrate: () => Promise<void>;
  /** Rename a cached merchant. Passing the cached title clears the overlay. */
  rename: (id: string, title: string | undefined) => Promise<void>;
  addNew: (item: NewCounterparty) => Promise<void>;
  /** Завести сразу нескольких — одна запись в IDB на всю пачку, иначе разбор
   *  получателей без контрагента писал бы файл по разу на строку. */
  addManyNew: (items: NewCounterparty[]) => Promise<void>;
  /** Rename an unpushed new counterparty. */
  renameNew: (id: string, title: string) => Promise<void>;
  /** Remove a counterparty: an unpushed draft is dropped outright, a cached one
   *  is queued for cloud deletion. */
  remove: (id: string) => Promise<void>;
  /**
   * Убрать сразу несколько НЕОТПРАВЛЕННЫХ черновиков — одной записью в базу.
   *
   * Для отмены импорта: партия завела контрагентов, партию откатывают. Здесь
   * никогда не ставится ZenDeletion — удалять в облаке нечего, записи туда
   * ещё не уезжали. Чужие id молча игнорируются.
   */
  removeManyNew: (ids: string[]) => Promise<void>;
  /** Undo a queued deletion — or a queued merge — of a cached counterparty. */
  restore: (id: string) => Promise<void>;
  /** Queue folding `id` into `survivorId`: the operations move over, then `id`
   *  is deleted. Both must be cached rows (a draft has nothing to move). */
  merge: (id: string, survivorId: string) => Promise<void>;
  /** Queue many merges at once — one IDB write for a whole dedupe sweep. */
  mergeMany: (pairs: { id: string; survivorId: string }[]) => Promise<void>;
  /** Drop entries that were successfully pushed. */
  clearPushed: (opts: {
    renamedIds?: string[];
    createdIds?: string[];
    deletedIds?: string[];
    mergedIds?: string[];
  }) => Promise<void>;
  clearAll: () => Promise<void>;
}

const EMPTY: Persisted = { renames: {}, created: [], deleted: [], merges: {} };

export const useCounterpartyEditsStore = create<State>((set, get) => {
  async function persist(next: Persisted) {
    await db.saveJSON(KEY, next);
    set(next);
  }
  function snapshot(): Persisted {
    const s = get();
    return {
      renames: s.renames,
      created: s.created,
      deleted: s.deleted,
      merges: s.merges,
    };
  }

  return {
    ...EMPTY,
    loaded: false,

    hydrate: async () => {
      const data = await db.loadJSON<Partial<Persisted>>(KEY);
      set({
        renames: data?.renames ?? {},
        created: Array.isArray(data?.created) ? data.created : [],
        deleted: Array.isArray(data?.deleted) ? data.deleted : [],
        merges: data?.merges ?? {},
        loaded: true,
      });
    },

    rename: async (id, title) => {
      const renames = { ...get().renames };
      if (title === undefined) delete renames[id];
      else renames[id] = title;
      await persist({ ...snapshot(), renames });
    },

    addNew: async (item) => {
      await persist({ ...snapshot(), created: [...get().created, item] });
    },

    addManyNew: async (items) => {
      if (items.length === 0) return;
      await persist({ ...snapshot(), created: [...get().created, ...items] });
    },

    renameNew: async (id, title) => {
      const created = get().created.map((c) => (c.id === id ? { ...c, title } : c));
      await persist({ ...snapshot(), created });
    },

    removeManyNew: async (ids) => {
      const drop = new Set(ids);
      const s = snapshot();
      const created = s.created.filter((c) => !drop.has(c.id));
      if (created.length === s.created.length) return;
      const renames = { ...s.renames };
      for (const id of drop) delete renames[id];
      await persist({ ...s, renames, created });
    },

    remove: async (id) => {
      const s = snapshot();
      const isDraft = s.created.some((c) => c.id === id);
      if (isDraft) {
        // Never pushed → just drop the draft (and any rename on it).
        const renames = { ...s.renames };
        delete renames[id];
        await persist({
          ...s,
          renames,
          created: s.created.filter((c) => c.id !== id),
        });
        return;
      }
      if (s.deleted.includes(id)) return;
      // A pending rename is moot once the row is being deleted, as is a merge
      // INTO it — those duplicates would otherwise be re-pointed at a row that
      // no longer exists.
      const renames = { ...s.renames };
      delete renames[id];
      const merges = { ...s.merges };
      delete merges[id];
      for (const [dup, survivor] of Object.entries(merges)) {
        if (survivor === id) delete merges[dup];
      }
      await persist({ ...s, renames, merges, deleted: [...s.deleted, id] });
    },

    restore: async (id) => {
      const s = snapshot();
      const merges = { ...s.merges };
      const wasMerged = merges[id] !== undefined;
      delete merges[id];
      if (!s.deleted.includes(id) && !wasMerged) return;
      await persist({ ...s, merges, deleted: s.deleted.filter((d) => d !== id) });
    },

    merge: async (id, survivorId) => {
      await get().mergeMany([{ id, survivorId }]);
    },

    mergeMany: async (pairs) => {
      const s = snapshot();
      const merges = { ...s.merges };
      const renames = { ...s.renames };
      const drafts = new Set(s.created.map((c) => c.id));
      const deleted = new Set(s.deleted);
      for (const { id, survivorId } of pairs) {
        // A draft has no cloud row and no operations — nothing to fold.
        if (id === survivorId || drafts.has(id) || drafts.has(survivorId)) continue;
        if (deleted.has(id) || deleted.has(survivorId)) continue;
        merges[id] = survivorId;
        delete renames[id]; // the row is going away — its rename is moot
      }
      await persist({ ...s, renames, merges });
    },

    clearPushed: async ({
      renamedIds = [],
      createdIds = [],
      deletedIds = [],
      mergedIds = [],
    }) => {
      const s = snapshot();
      const renames = { ...s.renames };
      for (const id of renamedIds) delete renames[id];
      const merges = { ...s.merges };
      for (const id of mergedIds) delete merges[id];
      const createdDrop = new Set(createdIds);
      const deletedDrop = new Set(deletedIds);
      await persist({
        renames,
        merges,
        created: s.created.filter((c) => !createdDrop.has(c.id)),
        deleted: s.deleted.filter((d) => !deletedDrop.has(d)),
      });
    },

    clearAll: async () => {
      await persist({ ...EMPTY });
    },
  };
});

/** How many counterparty changes are waiting to go to the cloud. Shared by the
 *  auto-push scheduler and the «В очереди» counter so both count the same way. */
export function countCounterpartyPending(s: Persisted): number {
  return (
    Object.keys(s.renames).length +
    s.created.length +
    s.deleted.length +
    Object.keys(s.merges).length
  );
}

/** Read pending counterparty edits without a hook — for the push builders. */
export async function loadCounterpartyEdits(): Promise<Persisted> {
  const s = useCounterpartyEditsStore.getState();
  if (s.loaded)
    return {
      renames: s.renames,
      created: s.created,
      deleted: s.deleted,
      merges: s.merges,
    };
  const disk = await db.loadJSON<Partial<Persisted>>(KEY);
  return {
    renames: disk?.renames ?? {},
    created: Array.isArray(disk?.created) ? disk.created : [],
    deleted: Array.isArray(disk?.deleted) ? disk.deleted : [],
    merges: disk?.merges ?? {},
  };
}
