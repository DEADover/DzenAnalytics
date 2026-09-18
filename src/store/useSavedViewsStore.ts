import { create } from "zustand";
import * as db from "../lib/db";
import type { DatePreset } from "./useFiltersStore";

export interface SavedView {
  id: string;
  name: string;
  preset: DatePreset;
  from: string | null;
  to: string | null;
  monthYM?: string | null;
  accounts: string[];
  categories: string[];
  currencies: string[];
  search: string;
  excludeTransfers: boolean;
  /** Whether this filter also captures the PERIOD (month / range). When false,
   *  applying it leaves the current period untouched and changing the period
   *  never marks the filter «изменён». Optional for back-compat: filters saved
   *  before this flag existed always carried a period → treated as `true`. */
  includePeriod?: boolean;
  createdAt: string;
}

/** The mutable part of a saved filter (everything except identity). */
export type SavedViewInput = Omit<SavedView, "id" | "createdAt">;

/** «What» dimensions of a filter — everything EXCEPT the period. */
export interface FilterCriteria {
  accounts: string[];
  categories: string[];
  currencies: string[];
  search: string;
  excludeTransfers: boolean;
}
/** Period dimensions of a filter. */
export interface PeriodCriteria {
  preset: DatePreset;
  from: string | null;
  to: string | null;
  monthYM: string | null;
}

const sortedJoin = (a: string[]) => [...a].sort().join("\u0000");

/** Canonical signature of the «what» dimensions — order-independent for the
 *  multi-selects, trimmed search. Two states with the same signature filter
 *  identically. */
export function whatSignature(c: FilterCriteria): string {
  return [
    sortedJoin(c.accounts),
    sortedJoin(c.categories),
    sortedJoin(c.currencies),
    c.search.trim(),
    c.excludeTransfers ? "1" : "0",
  ].join("¦");
}

export function periodSignature(p: {
  preset: DatePreset;
  from: string | null;
  to: string | null;
  monthYM?: string | null;
}): string {
  return [p.preset, p.from ?? "", p.to ?? "", p.monthYM ?? ""].join("¦");
}

/** True when the live state still MATCHES the saved view (i.e. NOT «изменён»).
 *  Period is compared only when the view captures it (`includePeriod`). */
export function matchesView(
  view: SavedView,
  live: FilterCriteria & PeriodCriteria
): boolean {
  if (whatSignature(view) !== whatSignature(live)) return false;
  if ((view.includePeriod ?? true) && periodSignature(view) !== periodSignature(live))
    return false;
  return true;
}

/** True when the live state has ANY «what» filter set (≠ «Без фильтрации»). */
export function hasWhatFilters(c: FilterCriteria): boolean {
  return (
    c.accounts.length > 0 ||
    c.categories.length > 0 ||
    c.currencies.length > 0 ||
    c.search.trim().length > 0 ||
    c.excludeTransfers
  );
}

interface SavedViewsState {
  views: SavedView[];
  loaded: boolean;
  /** Id of the currently-applied filter, or null for «Без фильтрации». Session
   *  only (not persisted) — the filter state itself resets on reload too. */
  activeId: string | null;
  hydrate: () => Promise<void>;
  /** Create a filter; returns its new id (so the caller can mark it active). */
  add: (view: SavedViewInput) => Promise<string>;
  /** Overwrite a filter's captured settings (edit in place), keeping id/name. */
  update: (id: string, patch: Partial<SavedViewInput>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  setActiveId: (id: string | null) => void;
  /** Заменить список целиком — перенос настроек между устройствами. */
  replaceAll: (items: readonly SavedView[]) => Promise<void>;
}

export const useSavedViewsStore = create<SavedViewsState>((set, get) => ({
  views: [],
  loaded: false,
  activeId: null,

  hydrate: async () => {
    const data = await db.loadJSON<SavedView[]>("savedViews");
    set({ views: data || [], loaded: true });
  },

  add: async (view) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const next: SavedView = { ...view, id, createdAt: new Date().toISOString() };
    const list = [...get().views, next];
    await db.saveJSON("savedViews", list);
    set({ views: list });
    return id;
  },

  update: async (id, patch) => {
    const list = get().views.map((v) => (v.id === id ? { ...v, ...patch } : v));
    await db.saveJSON("savedViews", list);
    set({ views: list });
  },

  remove: async (id) => {
    const list = get().views.filter((v) => v.id !== id);
    await db.saveJSON("savedViews", list);
    set({ views: list, activeId: get().activeId === id ? null : get().activeId });
  },

  rename: async (id, name) => {
    const list = get().views.map((v) => (v.id === id ? { ...v, name } : v));
    await db.saveJSON("savedViews", list);
    set({ views: list });
  },

  setActiveId: (activeId) => set({ activeId }),

  replaceAll: async (items) => {
    const list = items.filter((v) => v && typeof v.id === "string").map((v) => ({ ...v }));
    await db.saveJSON("savedViews", list);
    // Применённый вид могли удалить на другом устройстве — тогда снимаем
    // пометку, иначе панель показывала бы имя несуществующего фильтра.
    const activeId = get().activeId;
    set({ views: list, activeId: list.some((v) => v.id === activeId) ? activeId : null });
  },
}));
