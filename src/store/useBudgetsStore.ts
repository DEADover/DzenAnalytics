import { create } from "zustand";
import * as db from "../lib/db";
import { dedupeLines, nameKey } from "../lib/budgetLines";
import {
  migrateLegacyBudgets,
  plannedFor,
  lockedFor,
  budgetCellKey,
  type BudgetLine,
  type BudgetKind,
} from "../lib/budgets";

/** A Zenmoney plan row, ready to seed a budget line. */
export interface ZenPlanSeed {
  kind: BudgetKind;
  /** Тег Дзен-мани: тождество строки, переживающее переименование статьи. */
  tagId?: string;
  category: string;
  /** Sub-category title, or null when the plan is on the parent tag itself. */
  subcategory: string | null;
  ym: string; // "YYYY-MM"
  amount: number;
  /** Замок Дзен-мани: сумма точная, под-категории уже внутри неё. */
  locked?: boolean;
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
      // Задвоенные строки — след старой модели, где статья опознавалась только
      // именем: после переименования категории в Дзен-мани рядом со старой
      // строкой заводилась новая, и обе показывались на экране, а план
      // родителя складывался из двух. Лечим при первом же чтении.
      const { lines, merged } = dedupeLines(stored);
      if (merged > 0) await db.saveJSON(KEY, lines);
      set({ lines, loaded: true });
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
    // Имена нормализуются: хвостовой или неразрывный пробел в названии тега
    // невидим на экране, а строку разводил на две (см. `budgetLines`).
    const idOf = (kind: string, category: string, sub: string | null) =>
      nameKey(kind as BudgetKind, category, sub);
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
    // Имена нормализуются: хвостовой или неразрывный пробел в названии тега
    // невидим на экране, а строку разводил на две (см. `budgetLines`).
    const idOf = (kind: string, category: string, sub: string | null) =>
      nameKey(kind as BudgetKind, category, sub);
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
    interface PlanGroup {
      kind: BudgetKind;
      /** Тег Дзен-мани — по нему строка и опознаётся в первую очередь. */
      tagId?: string;
      category: string;
      subcategory: string | null;
      months: Map<string, number>;
      /** Месяцы с замком: «сумма точная, под-категории уже внутри». */
      locks: Map<string, boolean>;
    }
    const groups = new Map<string, PlanGroup>();
    for (const p of plans) {
      if (!(p.amount > 0)) continue;
      // Группируем ПО ТЕГУ, если он известен: в Дзен-мани две разные статьи
      // могут называться одинаково, и по именам их планы сливались в один —
      // на экране оставалась сумма только одной из них.
      const key = p.tagId ? `tag\u0000${p.tagId}` : idOf(p.kind, p.category, p.subcategory);
      let g = groups.get(key);
      if (!g) {
        g = {
          kind: p.kind,
          ...(p.tagId ? { tagId: p.tagId } : {}),
          category: p.category,
          subcategory: p.subcategory,
          months: new Map(),
          locks: new Map(),
        };
        groups.set(key, g);
      }
      g.months.set(p.ym, p.amount);
      g.locks.set(p.ym, !!p.locked);
    }
    if (groups.size === 0) return;

    const seen = new Set<string>();
    let changed = false;

    // Строку ищем СНАЧАЛА по тегу и только потом по именам: тег переживает
    // переименование категории, а имена — нет. Без этого переименованная в
    // Дзен-мани статья заводила себе вторую строку рядом со старой (задвоение
    // на экране и удвоенный план у родителя).
    const byTag = new Map<string, PlanGroup>();
    // Запасной поиск по именам — для строк, заведённых вручную или до появления
    // тегов: тождества по тегу у них ещё нет, привязать их к плану можно только
    // по названию. При первой же синхронизации они тег получат.
    const byName = new Map<string, PlanGroup>();
    for (const g of groups.values()) {
      if (g.tagId) byTag.set(g.tagId, g);
      byName.set(idOf(g.kind, g.category, g.subcategory), g);
    }

    // 1) Update EXISTING lines in place — adopt Zen's per-month value unless the
    //    cell is locally edited (protected) or already equal.
    const updated = get().lines.map((l) => {
      const byTagId = l.tagId ? byTag.get(l.tagId) : undefined;
      const g = byTagId ?? byName.get(idOf(l.kind, l.category, l.subcategory ?? null));
      if (!g) return l;
      const key = g.tagId ? `tag\u0000${g.tagId}` : idOf(g.kind, g.category, g.subcategory);
      seen.add(key);
      // Тег переименовали — строка та же, имена новые. Заодно ставим тег тем
      // строкам, что завелись до его появления.
      const renamed =
        l.category !== g.category || (l.subcategory ?? null) !== g.subcategory;
      const stamp: Partial<BudgetLine> =
        l.tagId === g.tagId && !renamed
          ? {}
          : {
              ...(g.tagId ? { tagId: g.tagId } : {}),
              category: g.category,
              subcategory: g.subcategory,
            };
      let next: Record<string, number> | undefined;
      let nextLocks: Record<string, boolean> | undefined;
      for (const [ym, amt] of g.months) {
        if (
          protectedSet.has(
            budgetCellKey(l.kind, l.category, l.subcategory ?? null, ym)
          )
        )
          continue;
        // Замок приезжает вместе с суммой: он меняет не число, а его смысл
        // («вся категория» против «только своё»), и отстать от суммы не должен.
        const lock = !!g.locks.get(ym);
        if (lockedFor(l, ym) !== lock) {
          nextLocks = nextLocks ?? { ...(l.locks ?? {}) };
          if (lock) nextLocks[ym] = true;
          else delete nextLocks[ym];
        }
        if (plannedFor(l, ym) === amt) continue;
        if (!next) next = { ...(l.overrides ?? {}) };
        next[ym] = amt;
      }
      if (!next && !nextLocks && Object.keys(stamp).length === 0) return l;
      changed = true;
      return {
        ...l,
        ...stamp,
        ...(next ? { overrides: next } : {}),
        ...(nextLocks ? { locks: nextLocks } : {}),
      };
    });

    // 2) Create lines for tags with no line yet. Zenmoney plans are PER-MONTH,
    //    not recurring: store each planned month as an explicit override.
    const additions: BudgetLine[] = [];
    for (const [key, g] of groups) {
      if (seen.has(key)) continue;
      const months = [...g.months.keys()].sort();
      const overrides: Record<string, number> = {};
      for (const [m, amt] of g.months) overrides[m] = amt;
      const locks: Record<string, boolean> = {};
      for (const [m, on] of g.locks) if (on) locks[m] = true;
      additions.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ...(g.tagId ? { tagId: g.tagId } : {}),
        category: g.category,
        subcategory: g.subcategory,
        kind: g.kind,
        amount: 0,
        recurrence: "monthly",
        startMonth: months[0],
        endMonth: null,
        overrides,
        ...(Object.keys(locks).length > 0 ? { locks } : {}),
        createdAt: new Date().toISOString(),
      });
    }

    if (!changed && additions.length === 0) return;
    // Слияние на выходе — страховка: если в хранилище уже лежали две строки
    // одной статьи (наследство от опознания по именам), синхронизация не
    // должна оставить их обе.
    const { lines: list } = dedupeLines([...updated, ...additions]);
    await db.saveJSON(KEY, list);
    set({ lines: list });
  },

  clearAll: async () => {
    await db.saveJSON(KEY, []);
    set({ lines: [] });
  },
}));
