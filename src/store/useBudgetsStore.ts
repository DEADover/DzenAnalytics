import { create } from "zustand";
import * as db from "../lib/db";
import {
  migrateLegacyBudgets,
  plannedFor,
  budgetCellKey,
  type BudgetLine,
  type BudgetKind,
} from "../lib/budgets";

/** A Zenmoney plan row, ready to seed a budget line. */
export interface ZenPlanSeed {
  kind: BudgetKind;
  category: string;
  /** Sub-category title, or null when the plan is on the parent tag itself. */
  subcategory: string | null;
  ym: string; // "YYYY-MM"
  amount: number;
}

/** План одной статьи на один месяц — единица массового заполнения. */
export interface PlanUpsert {
  kind: BudgetKind;
  category: string;
  subcategory: string | null;
  ym: string;
  amount: number;
}

const KEY = "budgetsV2";
const LEGACY_KEY = "budgets";

function thisMonth(now = Date.now()): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

interface BudgetsState {
  lines: BudgetLine[];
  loaded: boolean;
  hydrate: () => Promise<void>;
  addLine: (line: Omit<BudgetLine, "id" | "createdAt">) => Promise<void>;
  updateLine: (id: string, patch: Partial<BudgetLine>) => Promise<void>;
  removeLine: (id: string) => Promise<void>;
  /** Set (or clear, when amount === null) a per-month override for a line. */
  setOverride: (id: string, ym: string, amount: number | null) => Promise<void>;
  /** Задать план сразу нескольким статьям за ОДНУ запись. Поштучный вызов
   *  `addLine`/`setOverride` в цикле здесь не годится: каждый из них читает
   *  список, ждёт запись в базу и кладёт свою версию обратно — из шести правок
   *  доезжала последняя. */
  applyPlans: (items: PlanUpsert[]) => Promise<void>;
  /** Mirror Zenmoney plans into local budget lines. THREE-WAY merge: new tags
   *  are created; a cell the user hasn't locally edited adopts Zen's value (so a
   *  plan changed in Дзен shows up here); a cell the user edited locally but not
   *  yet pushed (its id is in `protectedKeys` = pending budgetEdit ids) is kept.
   *  Called after every sync so plan changes propagate automatically. */
  importFromZen: (
    plans: ZenPlanSeed[],
    protectedKeys?: Set<string>
  ) => Promise<void>;
  clearAll: () => Promise<void>;
}

export const useBudgetsStore = create<BudgetsState>((set, get) => ({
  lines: [],
  loaded: false,

  hydrate: async () => {
    const stored = await db.loadJSON<BudgetLine[]>(KEY);
    if (stored) {
      set({ lines: stored, loaded: true });
      return;
    }
    // First run on the new model → migrate the legacy flat budgets, if any.
    const legacy = await db.loadJSON<Record<string, number>>(LEGACY_KEY);
    const migrated = migrateLegacyBudgets(legacy, thisMonth());
    if (migrated.length > 0) await db.saveJSON(KEY, migrated);
    set({ lines: migrated, loaded: true });
  },

  addLine: async (line) => {
    const next: BudgetLine = {
      ...line,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
    };
    const list = [...get().lines, next];
    await db.saveJSON(KEY, list);
    set({ lines: list });
  },

  updateLine: async (id, patch) => {
    const list = get().lines.map((l) => (l.id === id ? { ...l, ...patch } : l));
    await db.saveJSON(KEY, list);
    set({ lines: list });
  },

  removeLine: async (id) => {
    const list = get().lines.filter((l) => l.id !== id);
    await db.saveJSON(KEY, list);
    set({ lines: list });
  },

  setOverride: async (id, ym, amount) => {
    const list = get().lines.map((l) => {
      if (l.id !== id) return l;
      const overrides = { ...(l.overrides ?? {}) };
      if (amount === null) delete overrides[ym];
      else overrides[ym] = amount;
      const hasAny = Object.keys(overrides).length > 0;
      return { ...l, overrides: hasAny ? overrides : undefined };
    });
    await db.saveJSON(KEY, list);
    set({ lines: list });
  },

  applyPlans: async (items) => {
    if (items.length === 0) return;
    const idOf = (kind: string, category: string, sub: string | null) =>
      [kind, category, sub ?? ""].join("\u0000");
    // Одна правка на статью: если одна и та же статья пришла дважды, побеждает
    // последняя — как и при обычном редактировании.
    const wanted = new Map<string, PlanUpsert>();
    for (const it of items) wanted.set(idOf(it.kind, it.category, it.subcategory), it);

    const seen = new Set<string>();
    const updated = get().lines.map((l) => {
      const key = idOf(l.kind, l.category, l.subcategory ?? null);
      const it = wanted.get(key);
      if (!it) return l;
      seen.add(key);
      return { ...l, overrides: { ...(l.overrides ?? {}), [it.ym]: it.amount } };
    });

    const additions: BudgetLine[] = [];
    for (const [key, it] of wanted) {
      if (seen.has(key) || it.amount <= 0) continue;
      additions.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        category: it.category,
        subcategory: it.subcategory,
        kind: it.kind,
        amount: 0,
        recurrence: "monthly",
        startMonth: it.ym,
        endMonth: null,
        overrides: { [it.ym]: it.amount },
        createdAt: new Date().toISOString(),
      });
    }

    const list = [...updated, ...additions];
    await db.saveJSON(KEY, list);
    set({ lines: list });
  },

  importFromZen: async (plans, protectedKeys) => {
    // Identity is per TAG: (kind, category, subcategory). NUL-joined so titles
    // with «:» don't collide.
    const idOf = (kind: string, category: string, sub: string | null) =>
      [kind, category, sub ?? ""].join("\u0000");
    // `protectedSet` holds `budgetCellKey`s for cells the user edited locally
    // but hasn't pushed — those are shielded from Zen's value below.
    const protectedSet = protectedKeys ?? new Set<string>();

    // Zenmoney budgets are the source of truth for plans EXCEPT cells the user
    // changed locally and hasn't pushed yet (those sit in `budgetEdits`, passed
    // in as `protectedSet`). Three-way merge:
    //   • tag with no local line          → create it (seed every planned month);
    //   • existing line, cell NOT edited   → adopt Zen's value — this is what
    //                                        makes a plan changed in Дзен appear;
    //   • existing line, cell edited local → keep local (don't clobber the user's
    //                                        own 305k with a stale 230k on sync).
    // Cells Zen doesn't mention are left untouched — we never blank an override.
    const groups = new Map<
      string,
      {
        kind: BudgetKind;
        category: string;
        subcategory: string | null;
        months: Map<string, number>;
      }
    >();
    for (const p of plans) {
      if (!(p.amount > 0)) continue;
      const key = idOf(p.kind, p.category, p.subcategory);
      let g = groups.get(key);
      if (!g) {
        g = { kind: p.kind, category: p.category, subcategory: p.subcategory, months: new Map() };
        groups.set(key, g);
      }
      g.months.set(p.ym, p.amount);
    }
    if (groups.size === 0) return;

    const seen = new Set<string>();
    let changed = false;

    // 1) Update EXISTING lines in place — adopt Zen's per-month value unless the
    //    cell is locally edited (protected) or already equal.
    const updated = get().lines.map((l) => {
      const key = idOf(l.kind, l.category, l.subcategory ?? null);
      const g = groups.get(key);
      if (!g) return l;
      seen.add(key);
      let next: Record<string, number> | undefined;
      for (const [ym, amt] of g.months) {
        if (
          protectedSet.has(
            budgetCellKey(l.kind, l.category, l.subcategory ?? null, ym)
          )
        )
          continue;
        if (plannedFor(l, ym) === amt) continue;
        if (!next) next = { ...(l.overrides ?? {}) };
        next[ym] = amt;
      }
      if (!next) return l;
      changed = true;
      return { ...l, overrides: next };
    });

    // 2) Create lines for tags with no line yet. Zenmoney plans are PER-MONTH,
    //    not recurring: store each planned month as an explicit override.
    const additions: BudgetLine[] = [];
    for (const [key, g] of groups) {
      if (seen.has(key)) continue;
      const months = [...g.months.keys()].sort();
      const overrides: Record<string, number> = {};
      for (const [m, amt] of g.months) overrides[m] = amt;
      additions.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        category: g.category,
        subcategory: g.subcategory,
        kind: g.kind,
        amount: 0,
        recurrence: "monthly",
        startMonth: months[0],
        endMonth: null,
        overrides,
        createdAt: new Date().toISOString(),
      });
    }

    if (!changed && additions.length === 0) return;
    const list = [...updated, ...additions];
    await db.saveJSON(KEY, list);
    set({ lines: list });
  },

  clearAll: async () => {
    await db.saveJSON(KEY, []);
    set({ lines: [] });
  },
}));
