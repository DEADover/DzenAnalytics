import { describe, expect, it } from "vitest";
import { categoryTrends, fullMonths, trendOf } from "./categoryTrends";
import type { Transaction } from "../types";

function tx(date: string, category: string, amount: number, kind: Transaction["kind"] = "expense"): Transaction {
  return {
    id: `${date}-${category}-${amount}-${kind}`,
    date,
    category,
    subcategory: null,
    categoryFull: category,
    payee: "",
    comment: "",
    kind,
    amount,
    amountBase: amount,
    currency: "RUB",
    account: "Карта",
    outcomeAccount: "Карта",
    incomeAccount: "",
    outcomeAmount: amount,
    incomeAmount: 0,
    outcomeCurrency: "RUB",
    incomeCurrency: "RUB",
    opAmount: null,
    opCurrency: null,
    createdAt: `${date}T10:00:00Z`,
  } as Transaction;
}

describe("trendOf", () => {
  it("рост и снижение — по линии тренда", () => {
    expect(trendOf([100, 120, 140, 160]).group).toBe("rising");
    expect(trendOf([160, 140, 120, 100]).group).toBe("falling");
    expect(trendOf([100, 120, 140, 160]).trendChange).toBeCloseTo(60);
  });
  it("колебания без направления — «плавает»", () => {
    expect(trendOf([100, 130, 95, 125, 100]).group).toBe("floating");
    expect(trendOf([100, 100, 100]).group).toBe("floating");
  });
  it("один пустой месяц в конце не отменяет рост", () => {
    expect(trendOf([10, 40, 80, 120, 160, 0]).group).toBe("rising");
  });
  it("по двум месяцам тренда нет", () => {
    expect(trendOf([100, 500])).toEqual({ group: "floating", trendChange: 0 });
  });
});

describe("fullMonths", () => {
  const txs = [tx("2026-06-10", "Еда", 1), tx("2026-08-03", "Еда", 1), tx("2026-10-05", "Еда", 1)];
  it("без пропусков и без идущего месяца", () => {
    expect(fullMonths(txs, 1, "2026-10-15")).toEqual(["2026-06", "2026-07", "2026-08", "2026-09"]);
  });
  it("законченный период берётся целиком", () => {
    expect(fullMonths(txs, 1, "2026-12-01")).toEqual(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
  });
  it("операций нет — месяцев нет", () => {
    expect(fullMonths([], 1, "2026-10-15")).toEqual([]);
  });
});

describe("categoryTrends", () => {
  const months = ["2026-06", "2026-07", "2026-08"];
  const txs = [
    tx("2026-06-05", "Еда", 100),
    tx("2026-07-05", "Еда", 200),
    tx("2026-08-05", "Еда", 300),
    tx("2026-06-07", "Такси", 300),
    tx("2026-08-07", "Такси", 50),
    // Возврат уменьшает расход своего месяца.
    tx("2026-07-09", "Еда", 50, "refund"),
    // Идущий месяц и доходы в расходные ряды не попадают.
    tx("2026-09-01", "Еда", 999),
    tx("2026-07-01", "Зарплата", 5000, "income"),
  ];
  it("собирает ряды, группы и общий итог", () => {
    const { rows, total } = categoryTrends(txs, { level: "top", kind: "expense", monthStartDay: 1, months });
    const food = rows.find((r) => r.category === "Еда")!;
    expect(food.values).toEqual([100, 150, 300]);
    expect(food.first).toBe(100);
    expect(food.last).toBe(300);
    expect(food.group).toBe("rising");
    expect(rows.find((r) => r.category === "Такси")!.group).toBe("falling");
    expect(rows.map((r) => r.category).sort()).toEqual(["Еда", "Такси"]);
    expect(total.values).toEqual([400, 150, 350]);
  });
  it("доходы — отдельно", () => {
    const { rows } = categoryTrends(txs, { level: "top", kind: "income", monthStartDay: 1, months });
    expect(rows.map((r) => r.category)).toEqual(["Зарплата"]);
  });
});
