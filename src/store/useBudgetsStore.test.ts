import { describe, it, expect, beforeEach, vi } from "vitest";

// Хранилище в памяти вместо IndexedDB: массовая правка обязана доехать до диска
// целиком — именно на этом стыке она и терялась.
const disk = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../lib/db", () => ({
  loadJSON: async (key: string) => disk.get(key) ?? null,
  saveJSON: async (key: string, value: unknown) => {
    disk.set(key, JSON.parse(JSON.stringify(value)));
  },
}));

import { useBudgetsStore, type PlanUpsert } from "./useBudgetsStore";
import { plannedFor, type BudgetLine } from "../lib/budgets";

const KEY = "budgetsV2";

function upsert(p: Partial<PlanUpsert>): PlanUpsert {
  return {
    kind: "expense",
    category: "Еда",
    subcategory: null,
    ym: "2026-08",
    amount: 1000,
    ...p,
  };
}

/** План статьи на месяц ПО ТОМУ, ЧТО ЛЕЖИТ НА ДИСКЕ. */
function stored(
  category: string,
  subcategory: string | null,
  ym: string
): number {
  const lines = (disk.get(KEY) as BudgetLine[] | undefined) ?? [];
  const l = lines.find(
    (x) => x.category === category && (x.subcategory ?? null) === subcategory
  );
  return l ? plannedFor(l, ym) : 0;
}

beforeEach(async () => {
  disk.clear();
  useBudgetsStore.setState({ lines: [], loaded: true });
});

describe("applyPlans", () => {
  it("сохраняет ВСЕ статьи за один вызов, а не последнюю", async () => {
    // Ровно та ошибка, из-за которой «Заполнить по среднему» доносило одну
    // строку из шести: поштучные addLine читали список до записи соседа.
    await useBudgetsStore.getState().applyPlans([
      upsert({ category: "Еда", amount: 20_000 }),
      upsert({ category: "Еда", subcategory: "Кафе", amount: 5000 }),
      upsert({ category: "Дом", subcategory: "Ремонт", amount: 45_000 }),
      upsert({ category: "Зарплата", kind: "income", amount: 200_000 }),
    ]);
    expect(useBudgetsStore.getState().lines).toHaveLength(4);
    expect(stored("Еда", null, "2026-08")).toBe(20_000);
    expect(stored("Еда", "Кафе", "2026-08")).toBe(5000);
    expect(stored("Дом", "Ремонт", "2026-08")).toBe(45_000);
    expect(stored("Зарплата", null, "2026-08")).toBe(200_000);
  });

  it("правит существующую строку, а не заводит вторую", async () => {
    await useBudgetsStore.getState().applyPlans([upsert({ amount: 1000 })]);
    await useBudgetsStore.getState().applyPlans([upsert({ amount: 3000 })]);
    expect(useBudgetsStore.getState().lines).toHaveLength(1);
    expect(stored("Еда", null, "2026-08")).toBe(3000);
  });

  it("не трогает планы других месяцев", async () => {
    await useBudgetsStore.getState().applyPlans([upsert({ ym: "2026-07", amount: 900 })]);
    await useBudgetsStore.getState().applyPlans([upsert({ ym: "2026-08", amount: 1000 })]);
    expect(stored("Еда", null, "2026-07")).toBe(900);
    expect(stored("Еда", null, "2026-08")).toBe(1000);
  });

  it("родитель и под-категория — разные статьи", async () => {
    await useBudgetsStore.getState().applyPlans([
      upsert({ amount: 1000 }),
      upsert({ subcategory: "Кафе", amount: 2000 }),
    ]);
    expect(stored("Еда", null, "2026-08")).toBe(1000);
    expect(stored("Еда", "Кафе", "2026-08")).toBe(2000);
  });

  it("расход и доход под одним тегом не сливаются", async () => {
    await useBudgetsStore.getState().applyPlans([
      upsert({ category: "Банки", amount: 1000 }),
      upsert({ category: "Банки", kind: "income", amount: 1500 }),
    ]);
    const lines = useBudgetsStore.getState().lines;
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => [l.kind, plannedFor(l, "2026-08")])).toEqual([
      ["expense", 1000],
      ["income", 1500],
    ]);
  });

  it("нулевую сумму новой строкой не заводит", async () => {
    await useBudgetsStore.getState().applyPlans([upsert({ amount: 0 })]);
    expect(useBudgetsStore.getState().lines).toEqual([]);
  });

  it("нулевой суммой снимает план с существующей строки", async () => {
    await useBudgetsStore.getState().applyPlans([upsert({ amount: 1000 })]);
    await useBudgetsStore.getState().applyPlans([upsert({ amount: 0 })]);
    expect(stored("Еда", null, "2026-08")).toBe(0);
  });

  it("пустой список ничего не пишет", async () => {
    await useBudgetsStore.getState().applyPlans([]);
    expect(disk.has(KEY)).toBe(false);
  });
});
