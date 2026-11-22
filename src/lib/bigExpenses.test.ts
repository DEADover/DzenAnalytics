import { describe, expect, it } from "vitest";
import { buildBigExpenses } from "./bigExpenses";
import { tx } from "../test/fixtures";

describe("buildBigExpenses", () => {
  it("самые большие расходы, с долями", () => {
    const b = buildBigExpenses(
      [
        tx({ id: "a", kind: "expense", amountBase: 100 }),
        tx({ id: "b", kind: "expense", amountBase: 700 }),
        tx({ id: "c", kind: "expense", amountBase: 200 }),
      ],
      2
    );
    expect(b.rows.map((r) => r.tx.id)).toEqual(["b", "c"]);
    expect(b.rows[0].share).toBeCloseTo(0.7);
    expect(b.topSum).toBe(900);
    expect(b.topShare).toBeCloseTo(0.9);
    expect(b.count).toBe(3);
  });

  it("доходы, переводы и возвраты не считаются", () => {
    const b = buildBigExpenses([
      tx({ id: "i", kind: "income", amountBase: 9_000 }),
      tx({ id: "t", kind: "transfer", amountBase: 8_000 }),
      tx({ id: "r", kind: "refund", amountBase: 7_000 }),
      tx({ id: "e", kind: "expense", amountBase: 100 }),
    ]);
    expect(b.rows.map((r) => r.tx.id)).toEqual(["e"]);
    expect(b.topShare).toBe(1);
  });

  it("при равной сумме выше более поздняя", () => {
    const b = buildBigExpenses([
      tx({ id: "old", kind: "expense", amountBase: 100, date: "2026-10-01" }),
      tx({ id: "new", kind: "expense", amountBase: 100, date: "2026-10-09" }),
    ]);
    expect(b.rows[0].tx.id).toBe("new");
  });

  it("пустой месяц", () => {
    expect(buildBigExpenses([])).toEqual({ rows: [], topSum: 0, topShare: 0, count: 0 });
  });
});
