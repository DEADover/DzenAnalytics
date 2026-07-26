// Categories queued for deletion in Дзен-мани, with what happens to their
// operations. Kept apart from useTagEditsStore on purpose: an edit patches a
// tag that stays, a deletion removes it and rewrites every operation that
// referenced it — different payload, different failure modes.
//
//   id → replacementId   category that inherits the operations
//   id → null            operations are left without a category
//
// Unpushed drafts never land here: they're dropped from useNewCategoriesStore
// outright, since nothing about them exists in the cloud yet.

import { create } from "zustand";
import * as db from "../lib/db";
import type { TagDeletion } from "../lib/zenmoneyPush";

const KEY = "tagDeletions";

type Persisted = Record<string, string | null>;

interface State {
  /** Tag id → replacement tag id, or null for «без категории». */
  deletions: Persisted;
  loaded: boolean;
  hydrate: () => Promise<void>;
  /** Queue a deletion (re-queuing overwrites the replacement choice). */
  remove: (id: string, replacementId: string | null) => Promise<void>;
  /** Un-queue a deletion. */
  restore: (id: string) => Promise<void>;
  /** Drop entries that were successfully pushed. */
  clearPushed: (ids: string[]) => Promise<void>;
  clearAll: () => Promise<void>;
}

export const useTagDeletionsStore = create<State>((set, get) => {
  async function persist(deletions: Persisted) {
    await db.saveJSON(KEY, deletions);
    set({ deletions });
  }

  return {
    deletions: {},
    loaded: false,

    hydrate: async () => {
      const data = await db.loadJSON<Persisted>(KEY);
      set({ deletions: data || {}, loaded: true });
    },

    remove: async (id, replacementId) => {
      await persist({ ...get().deletions, [id]: replacementId });
    },

    restore: async (id) => {
      const next = { ...get().deletions };
      if (next[id] === undefined) return;
      delete next[id];
      await persist(next);
    },

    clearPushed: async (ids) => {
      if (ids.length === 0) return;
      const next = { ...get().deletions };
      for (const id of ids) delete next[id];
      await persist(next);
    },

    clearAll: async () => {
      await persist({});
    },
  };
});

/** Shape the queue into the push builder's input. */
export function toTagDeletions(deletions: Persisted): TagDeletion[] {
  return Object.entries(deletions).map(([id, replacementId]) => ({
    id,
    replacementId,
  }));
}

/** Read queued deletions without a hook — for the push flow. */
export async function loadTagDeletions(): Promise<Persisted> {
  const s = useTagDeletionsStore.getState();
  if (s.loaded) return s.deletions;
  return (await db.loadJSON<Persisted>(KEY)) || {};
}
