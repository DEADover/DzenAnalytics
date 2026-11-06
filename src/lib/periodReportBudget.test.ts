import { describe, expect, it } from "vitest";
import { reportBudgetFromMonth } from "./periodReportBudget";
import {
  budgetMonthTotals,
  budgetPlanRows,
  budgetUnplannedRows,
  openingBudgetRow,
  type BudgetMonthSources,
} from "./budgetMonth";
import { planTotals, type BudgetLine } from "./budgets";
import { ALL_ACCOUNTS } from "./budgetScope";
import type { PlannedPlan } from "./plannedPlans";
import { zenPlanKey } from "./zenBudgets";
import type { Transaction } from "../types";
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

function sources(lines: BudgetLine[], txs: Transaction[], over: Partial<BudgetMonthSources> = {}): BudgetMonthSources {
  return {
    lines,
    transactions: txs,
    monthStartDay: 1,
    zenForecasts: new Map(),
    zenLoaded: true,
    zenRules: null,
    plannedAsPlan: [],
    livePaths: null,
    rowOrder: "alpha",
    ...over,
  };
}

/** Месяц так, как его собирают раздел «Бюджеты» и отчёт. */
function month(src: BudgetMonthSources, ym: string, opening: number | null = null) {
  const rows = budgetPlanRows(src, ym, ALL_ACCOUNTS);
  const unplanned = budgetUnplannedRows(src, ym, ALL_ACCOUNTS, rows);
  const open = openingBudgetRow(opening, ym, "2026-12");
  const all = [...(open ? [open] : []), ...rows, ...unplanned];
  const totals = budgetMonthTotals(all, src, ym, ALL_ACCOUNTS);
  return { all, totals, report: reportBudgetFromMonth(all, totals, ym, opening !== null) };
}

describe("бюджет месяца — один расчёт на раздел «Бюджеты» и отчёт", () => {
  it("расходы — все траты месяца: статьи с планом, без плана и «Без категории»", () => {
    const lines = [line(), line({ category: "Дом", amount: 500 }), line({ category: "Зарплата", kind: "income", amount: 5000 })];
    const txs = [
      tx({ date: "2026-03-10", category: "Еда", amount: 900 }),
      tx({ date: "2026-03-11", category: "Кафе", amount: 300 }),
      tx({ date: "2026-03-12", category: "", categoryFull: "", amount: 50 }),
      tx({ date: "2026-03-12", category: "Зарплата", kind: "income", amount: 5000 }),
      tx({ date: "2026-04-01", category: "Еда", amount: 999 }),
    ];
    const { totals, report } = month(sources(lines, txs), "2026-03");
    expect(totals.expense).toEqual({ plan: 1500, fact: 1250 });
    expect(totals.income).toEqual({ plan: 5000, fact: 5000 });
    expect(report!.rows).toEqual([
      { category: "Еда", plan: 1000, fact: 900 },
      { category: "Дом", plan: 500, fact: 0 },
    ]);
    // «Вне плана» — «Кафе» и «Без категории»: вместе со статьями это ровно факт расходов.
    expect(report!.unplanned).toBe(350);
    expect(report!.rows.reduce((s, r) => s + r.fact, 0) + report!.unplanned).toBe(totals.expense.fact);
    expect(report!.incomeTitle).toBe("Поступления");
  });

  it("план — как planTotals: залоченный родитель уже включает подкатегории", () => {
    const lines = [
      line({ category: "Животные", amount: 3000, locks: { "2026-03": true } }),
      line({ category: "Животные", subcategory: "Кот", amount: 1000 }),
    ];
    const { totals, report } = month(sources(lines, []), "2026-03");
    expect(totals.expense.plan).toBe(planTotals(lines, "2026-03").expense);
    expect(report!.rows[0]).toMatchObject({ category: "Животные", plan: 3000 });
  });

  it("подкатегория без замка — со своим планом внутри категории", () => {
    const lines = [line({ amount: 1000 }), line({ subcategory: "Кофе", amount: 200 })];
    const txs = [tx({ date: "2026-03-05", category: "Еда", subcategory: "Кофе", categoryFull: "Еда / Кофе", amount: 150 })];
    const { report } = month(sources(lines, txs), "2026-03");
    expect(report!.rows).toEqual([{ category: "Еда", plan: 1200, fact: 150 }]);
  });

  it("назначенная операция даёт план статье без своего плана, прогноз Дзен-мани — тоже, если включён", () => {
    const planned: PlannedPlan[] = [{ kind: "expense", category: "Садик", subcategory: null, ym: "2026-03", amount: 12000, ahead: 0, aheadOps: [] }];
    const lines = [line(), line({ category: "Такси", amount: 0 })];
    const forecasts = new Map([[zenPlanKey("expense", "Такси", null, "2026-03"), 800]]);
    const withRules = { forecasts: true } as unknown as BudgetMonthSources["zenRules"];
    const src = sources(lines, [], { plannedAsPlan: planned, zenForecasts: forecasts, zenRules: withRules });
    const { totals } = month(src, "2026-03");
    expect(totals.expense.plan).toBe(1000 + 12000 + 800);
  });

  it("входящий баланс — в «Деньги на месяц», но не в разницу", () => {
    const lines = [line({ category: "Зарплата", kind: "income", amount: 5000 })];
    const txs = [tx({ date: "2026-03-12", category: "Зарплата", kind: "income", amount: 5000 })];
    const { totals, report } = month(sources(lines, txs), "2026-03", 20000);
    expect(totals.income).toEqual({ plan: 25000, fact: 25000 });
    expect(totals.delta).toEqual({ plan: 5000, fact: 5000 });
    expect(report!.incomeTitle).toBe("Деньги на месяц");
  });

  it("без планов бюджета в отчёте нет", () => {
    expect(month(sources([], [tx({ date: "2026-03-01" })]), "2026-03").report).toBeNull();
  });
});
