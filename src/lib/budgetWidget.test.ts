import { describe, expect, it } from "vitest";
import type { BudgetMonthRow } from "./budgetMonth";
import { buildBudgetWidget } from "./budgetWidget";

const row = (
  category: string,
  planned: number,
  fact: number,
  extra: Partial<BudgetMonthRow> & { kind?: "expense" | "income"; subcategory?: string | null } = {}
) => {
  const { kind = "expense", subcategory = null, ...rest } = extra;
  return {
    line: { kind, category, subcategory },
    planned,
    fact,
    forecast: false,
    ...rest,
  } as unknown as BudgetMonthRow;
};

describe("buildBudgetWidget", () => {
  it("берёт расходные статьи с планом, самые потраченные первыми", () => {
    const w = buildBudgetWidget([
      row("Еда", 25_000, 13_000),
      row("Кафе", 5_000, 11_800),
      row("Зарплата", 150_000, 150_000, { kind: "income" }),
      row("Такси", 0, 455),
      row("Накопления", 20_000, 20_000, { planGroup: true }),
      row("Без категории", 0, 300, { unplanned: true }),
      row("Дом", 35_000, 35_000),
      row("Еда", 2_000, 2_400, { subcategory: "Сладкое" }),
    ]);
    expect(w.rows.map((r) => r.key)).toEqual(["Кафе|", "Еда|Сладкое", "Дом|", "Еда|"]);
    expect(w.over).toBe(2);
    expect(w.rows[0].ratio).toBeCloseTo(2.36);
  });

  it("при равной доле выше статья с большим планом", () => {
    const w = buildBudgetWidget([row("А", 1_000, 500), row("Б", 10_000, 5_000)]);
    expect(w.rows.map((r) => r.category)).toEqual(["Б", "А"]);
    expect(w.over).toBe(0);
  });

  it("без планов строк нет", () => {
    expect(buildBudgetWidget([])).toEqual({ rows: [], over: 0 });
  });
});
