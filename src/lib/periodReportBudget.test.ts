import { describe, expect, it } from "vitest";
import { buildReportBudget } from "./periodReportBudget";
import { planTotals, type BudgetLine } from "./budgets";
import { ALL_ACCOUNTS } from "./budgetScope";
import { tx } from "../test/fixtures";

const line = (over: Partial<BudgetLine> = {}): BudgetLine => ({
  id: Math.random().toString(36).slice(2),
  category: "Еда",
  subcategory: null,
  kind: "expense",
  amount: 1000,
  recurrence: "monthly",
  startMonth: "2026-01",
  endMonth: null,
  createdAt: "2026-01-01",
  ...over,
});

describe("buildReportBudget", () => {
  it("план — сумма месяцев периода, факт — по тем же месяцам", () => {
    const lines = [line(), line({ category: "Дом", amount: 500 }), line({ category: "Зарплата", kind: "income", amount: 5000 })];
    const txs = [
      tx({ date: "2026-02-03", category: "Еда", amount: 700 }),
      tx({ date: "2026-03-10", category: "Еда", amount: 900 }),
      tx({ date: "2026-03-11", category: "Кафе", amount: 300 }),
      tx({ date: "2026-03-12", category: "Зарплата", kind: "income", amount: 5000 }),
      tx({ date: "2026-04-01", category: "Еда", amount: 999 }),
    ];
    const b = buildReportBudget(lines, txs, ["2026-02", "2026-03"], ALL_ACCOUNTS, 1)!;
    expect(b.plan).toEqual({ income: 10000, expense: 3000 });
    expect(b.fact).toEqual({ income: 5000, expense: 1900 });
    expect(b.rows).toEqual([
      { category: "Еда", plan: 2000, fact: 1600 },
      { category: "Дом", plan: 1000, fact: 0 },
    ]);
    expect(b.plannedFact).toBe(1600);
    expect(b.unplanned).toBe(300);
  });

  it("план совпадает с planTotals: залоченный родитель уже включает подкатегории", () => {
    const lines = [
      line({ category: "Животные", amount: 3000, locks: { "2026-03": true } }),
      line({ category: "Животные", subcategory: "Кот", amount: 1000 }),
    ];
    const b = buildReportBudget(lines, [], ["2026-03"], ALL_ACCOUNTS, 1)!;
    expect(b.plan.expense).toBe(planTotals(lines, "2026-03").expense);
    expect(b.rows[0]).toMatchObject({ category: "Животные", plan: 3000 });
  });

  it("факт статьи — только за месяцы, где у неё есть план; остальное — вне плана", () => {
    const lines = [line({ startMonth: "2026-03", endMonth: "2026-03" })];
    const txs = [tx({ date: "2026-02-10", amount: 800 }), tx({ date: "2026-03-10", amount: 600 })];
    const b = buildReportBudget(lines, txs, ["2026-02", "2026-03"], ALL_ACCOUNTS, 1)!;
    expect(b.rows).toEqual([{ category: "Еда", plan: 1000, fact: 600 }]);
    expect(b.plannedFact).toBe(600);
    expect(b.unplanned).toBe(800);
  });

  it("подкатегории без замка складываются с родителем; без планов бюджета нет", () => {
    const lines = [line({ amount: 1000 }), line({ subcategory: "Кофе", amount: 200 })];
    expect(buildReportBudget(lines, [], ["2026-03"], ALL_ACCOUNTS, 1)!.rows[0].plan).toBe(1200);
    expect(buildReportBudget([], [], ["2026-03"], ALL_ACCOUNTS, 1)).toBeNull();
  });
});
