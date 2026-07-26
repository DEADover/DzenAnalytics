import { create } from "zustand";
import * as db from "../lib/db";

/**
 * Per-category «не учитывать в аналитике» set (issue #14).
 *
 * Some categories are pure turnover / mutual-settlement / reimbursement flows
 * that inflate income and expense totals without being real income or spending
 * (взаимозачёты, сплиты счёта, возмещения). The user marks such categories here
 * and the aggregate analytics widgets (Цели & FIRE, Здоровье, Что-Если, Год в
 * цифрах, Дайджест) strip their operations before computing anything.
 *
 * Keys match the transaction category exactly: a ROOT category by its title
 * («Переводы»), a sub-category by its full path («Родитель / Подкатегория») —
 * the same keying `categoryMeta` uses. Excluding a root covers all its subs
 * (the selector matches on `tx.category` OR `tx.categoryFull`).
 *
 * Stored as its own IDB blob rather than inside `categoryMeta`, because that map
 * is rebuilt from the Zenmoney cache on every sync (`setAll`) and would wipe a
 * local-only flag. This is a DzenAnalytics concept, not a Zenmoney one, so it
 * never rides to the cloud.
 */
interface State {
  excluded: Set<string>;
  loaded: boolean;
  hydrate: () => Promise<void>;
  toggle: (category: string) => Promise<void>;
  clear: () => Promise<void>;
}

const KEY = "analyticsExcludedCategories";

async function persist(set: Set<string>): Promise<void> {
  await db.saveJSON(KEY, [...set]);
}

export const useAnalyticsExclusionStore = create<State>((set, get) => ({
  excluded: new Set(),
  loaded: false,

  hydrate: async () => {
    const data = await db.loadJSON<string[]>(KEY);
    set({ excluded: new Set(Array.isArray(data) ? data : []), loaded: true });
  },

  toggle: async (category) => {
    const next = new Set(get().excluded);
    if (next.has(category)) next.delete(category);
    else next.add(category);
    await persist(next);
    set({ excluded: next });
  },

  clear: async () => {
    await persist(new Set());
    set({ excluded: new Set() });
  },
}));
