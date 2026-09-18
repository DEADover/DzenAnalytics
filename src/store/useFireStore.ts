import { create } from "zustand";
import * as db from "../lib/db";

/**
 * FIRE dashboard settings — which accounts count toward the "current capital"
 * that's subtracted from the FIRE target.
 *
 * We persist an *exclusion* list (by account title) rather than an inclusion
 * list, so the sensible default — "count everything I have" — needs no upfront
 * configuration and automatically picks up newly-added accounts. In particular
 * this means accounts that Zenmoney keeps *out* of its net-worth balance
 * (`inBalance:false`, e.g. savings/brokerage) still count toward FIRE capital
 * by default, which is exactly what the user expects: that money is real
 * accumulated capital even if they hide it from their day-to-day balance.
 *
 * Archived accounts are never counted (they're closed), independent of this list.
 */
interface FireState {
  /** Account titles the user has explicitly unchecked from FIRE capital. */
  excluded: string[];
  loaded: boolean;
  hydrate: () => Promise<void>;
  toggle: (title: string) => Promise<void>;
  /** Заменить список целиком — перенос настроек между устройствами. */
  replaceExcluded: (titles: readonly string[]) => Promise<void>;
  isExcluded: (title: string) => boolean;
}

const KEY = "fireExcludedAccounts";

export const useFireStore = create<FireState>((set, get) => ({
  excluded: [],
  loaded: false,
  hydrate: async () => {
    const data = await db.loadJSON<string[]>(KEY);
    set({ excluded: data || [], loaded: true });
  },
  toggle: async (title) => {
    const cur = get().excluded;
    const next = cur.includes(title)
      ? cur.filter((t) => t !== title)
      : [...cur, title];
    await db.saveJSON(KEY, next);
    set({ excluded: next });
  },
  replaceExcluded: async (titles) => {
    const next = titles.filter((t) => typeof t === "string");
    await db.saveJSON(KEY, next);
    set({ excluded: next });
  },
  isExcluded: (title) => get().excluded.includes(title),
}));
