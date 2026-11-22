import { describe, expect, it } from "vitest";
import type { BudgetMonthRow } from "./budgetMonth";
import { buildCategoryPlan } from "./categoryPlan";

const row = (
  category: string,
  planned: number,
  extra: Partial<BudgetMonthRow> & { kind?: "expense" | "income"; subcategory?: string | null } = {}
) => {
  const { kind = "expense", subcategory = null, ...rest } = extra;
  return { line: { kind, category, subcategory }, planned, fact: 0, forecast: false, ...rest } as unknown as BudgetMonthRow;
};

describe("buildCategoryPlan", () => {
  it("категория под замком — заданная сумма, подкатегории внутри", () => {
    const p = buildCategoryPlan(
      [row("Жильё", 60_000, { locked: true }), row("Жильё", 50_000, { subcategory: "Аренда" })],
      "expense"
    );
    expect(p.cat.get("Жильё")).toBe(60_000);
    expect(p.sub.get("Жильё / Аренда")).toBe(50_000);
    expect(p.own.has("Жильё")).toBe(false);
  });

  it("без замка — своя сумма плюс подкатегории", () => {
    const p = buildCategoryPlan(
      [row("Дети", 5_000), row("Дети", 10_000, { subcategory: "Секции" })],
      "expense"
    );
    expect(p.cat.get("Дети")).toBe(15_000);
    expect(p.own.get("Дети")).toBe(5_000);
  });

  it("одни подкатегории — их сумма", () => {
    const p = buildCategoryPlan(
      [row("Еда", 2_000, { subcategory: "Сладкое" }), row("Еда", 8_000, { subcategory: "Продукты" })],
      "expense"
    );
    expect(p.cat.get("Еда")).toBe(10_000);
  });

  it("отрицательная своя сумма — поправка", () => {
    const p = buildCategoryPlan([row("Авто", -1_000), row("Авто", 4_000, { subcategory: "Бензин" })], "expense");
    expect(p.cat.get("Авто")).toBe(3_000);
    expect(p.own.has("Авто")).toBe(false);
  });

  it("берёт только свою сторону и настоящие статьи", () => {
    const p = buildCategoryPlan(
      [
        row("Зарплата", 100_000, { kind: "income" }),
        row("Накопления", 5_000, { planGroup: true }),
        row("Входящий", 7_000, { opening: true }),
        row("Такси", 500, { unplanned: true }),
        row("Кафе", 3_000),
      ],
      "expense"
    );
    expect([...p.cat.keys()]).toEqual(["Кафе"]);
  });
});
