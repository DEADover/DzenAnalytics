// Locally-created categories/subcategories that haven't been pushed to
// Zenmoney yet. A create mints a fresh uuid and stores the full tag draft here;
// the manager renders them (with a «новая» badge) and the Push flow emits them
// as brand-new ZenTag[] alongside the edited ones. Cleared per-id on a
// successful push (the tag then comes back from the cloud on the next sync).

import { create } from "zustand";
import * as db from "../lib/db";
import { serialQueue } from "../lib/serialQueue";

export interface NewCategory {
  /** Fresh client-minted uuid — becomes the Zenmoney tag id on push. */
  id: string;
  title: string;
  /** Parent tag id, or null for a top-level category. */
  parent: string | null;
  showIncome: boolean;
  showOutcome: boolean;
  icon: string | null;
  color: number | null;
  required: boolean | null;
}

const KEY = "newCategories";

interface State {
  items: NewCategory[];
  loaded: boolean;
  hydrate: () => Promise<void>;
  add: (cat: NewCategory) => Promise<void>;
  update: (id: string, patch: Partial<Omit<NewCategory, "id">>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  removeMany: (ids: string[]) => Promise<void>;
  clear: () => Promise<void>;
}

/** Действия по одному — без гонки «прочитал → записал» (lib/serialQueue). */
const queue = serialQueue();

export const useNewCategoriesStore = create<State>((set, get) => ({
  items: [],
  loaded: false,

  hydrate: () => queue(async () => {
    const data = await db.loadJSON<NewCategory[]>(KEY);
    set({ items: Array.isArray(data) ? data : [], loaded: true });
  }),

  add: (cat) => queue(async () => {
    const next = [...get().items, cat];
    await db.saveJSON(KEY, next);
    set({ items: next });
  }),

  update: (id, patch) => queue(async () => {
    const next = get().items.map((c) => (c.id === id ? { ...c, ...patch } : c));
    await db.saveJSON(KEY, next);
    set({ items: next });
  }),

  remove: (id) => queue(async () => {
    const next = get().items.filter((c) => c.id !== id);
    await db.saveJSON(KEY, next);
    set({ items: next });
  }),

  removeMany: (ids) => queue(async () => {
    if (ids.length === 0) return;
    const drop = new Set(ids);
    const next = get().items.filter((c) => !drop.has(c.id));
    if (next.length === get().items.length) return;
    await db.saveJSON(KEY, next);
    set({ items: next });
  }),

  clear: () => queue(async () => {
    await db.saveJSON(KEY, []);
    set({ items: [] });
  }),
}));

/** Read new categories without a hook — for the push builder. */
export async function loadNewCategories(): Promise<NewCategory[]> {
  const s = useNewCategoriesStore.getState();
  if (s.loaded) return s.items;
  const disk = await db.loadJSON<NewCategory[]>(KEY);
  return Array.isArray(disk) ? disk : [];
}
