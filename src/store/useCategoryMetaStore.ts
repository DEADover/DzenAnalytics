// Per-category visual metadata pulled from Zenmoney's `tag` records.
// Persists as a single IDB blob and is refreshed on every successful sync.
//
// In CSV mode the map stays empty and UI falls back to default styling.

import { create } from "zustand";
import * as db from "../lib/db";
import type { CategoryMeta } from "../lib/zenmoneyMap";

interface State {
  meta: Record<string, CategoryMeta>;
  loaded: boolean;
  hydrate: () => Promise<void>;
  setAll: (m: Record<string, CategoryMeta>) => Promise<void>;
  /** Optimistically set a category's «обязательная» flag (the 50/30/20
   *  needs/wants source). Used by the Categories editor so the split updates
   *  instantly; the real value rides to the cloud via the tag-edit overlay. */
  setRequired: (category: string, required: boolean | null) => Promise<void>;
  /** Optimistically patch a category's display meta (colour / icon / type) by
   *  its meta key (root title or «Parent / Sub»), so dots and charts update the
   *  instant the editor saves — the real values ride to the cloud via the
   *  tag-edit overlay and are re-derived on the next sync. */
  patchMeta: (category: string, partial: Partial<CategoryMeta>) => Promise<void>;
  clear: () => Promise<void>;
}

const KEY = "categoryMeta";

export const useCategoryMetaStore = create<State>((set, get) => ({
  meta: {},
  loaded: false,

  hydrate: async () => {
    const data = await db.loadJSON<Record<string, CategoryMeta>>(KEY);
    set({ meta: data || {}, loaded: true });
  },

  setAll: async (m) => {
    await db.saveJSON(KEY, m);
    set({ meta: m });
  },

  setRequired: async (category, required) => {
    const cur = get().meta[category];
    // No meta row yet (e.g. a tag with no transactions) → synthesise a minimal
    // one so the flag still persists and the 50/30/20 split picks it up.
    const next = {
      ...get().meta,
      [category]: {
        ...(cur || { color: null, icon: null, picture: null }),
        required,
      },
    };
    await db.saveJSON(KEY, next);
    set({ meta: next });
  },

  patchMeta: async (category, partial) => {
    const cur = get().meta[category];
    const next = {
      ...get().meta,
      [category]: {
        ...(cur || { color: null, icon: null, picture: null }),
        ...partial,
      },
    };
    await db.saveJSON(KEY, next);
    set({ meta: next });
  },

  clear: async () => {
    await db.saveJSON(KEY, {});
    set({ meta: {} });
  },
}));
