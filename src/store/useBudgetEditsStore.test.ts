import { describe, it, expect, beforeEach, vi } from "vitest";

const disk = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../lib/db", () => ({
  loadJSON: async (key: string) => disk.get(key) ?? null,
  saveJSON: async (key: string, value: unknown) => {
    disk.set(key, JSON.parse(JSON.stringify(value)));
  },
}));

import { useBudgetEditsStore } from "./useBudgetEditsStore";
import type { BudgetEdit } from "../lib/zenmoneyPush";

const edit = (p: Partial<BudgetEdit>): BudgetEdit => ({
  kind: "expense",
  category: "Еда",
  subcategory: null,
  ym: "2026-10",
  amount: 1000,
  ...p,
});

beforeEach(() => {
  disk.clear();
  useBudgetEditsStore.setState({ edits: {}, loaded: true });
});

describe("очередь правок плана", () => {
  it("queueMany ставит в очередь все правки за одну запись", async () => {
    await useBudgetEditsStore.getState().queueMany([
      edit({ ym: "2026-10" }),
      edit({ ym: "2026-11" }),
      edit({ category: "Дом", ym: "2026-10" }),
    ]);
    expect(Object.keys(useBudgetEditsStore.getState().edits)).toHaveLength(3);
    expect(Object.keys(disk.get("budgetEdits") as object)).toHaveLength(3);
  });

  it("повтор той же клетки заменяет правку, а не добавляет вторую", async () => {
    await useBudgetEditsStore.getState().queueMany([edit({ amount: 1 }), edit({ amount: 2 })]);
    const edits = Object.values(useBudgetEditsStore.getState().edits);
    expect(edits.map((e) => e.amount)).toEqual([2]);
  });
});
