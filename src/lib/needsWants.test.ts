import { describe, it, expect } from "vitest";
import { buildNeedsWants, savingsRateSeries } from "./needsWants";
import { tx } from "../test/fixtures";

describe("buildNeedsWants", () => {
  const base = () => [
    tx({ kind: "income", amount: 100000, category: "Зарплата", date: "2026-03-05" }),
    tx({ kind: "expense", amount: 30000, category: "Аренда", date: "2026-03-06" }),
    tx({ kind: "expense", amount: 20000, category: "Кафе", date: "2026-03-07" }),
    tx({ kind: "expense", amount: 10000, category: "Прочее", date: "2026-03-08" }),
  ];

  it("splits needs (obligatory) / wants (optional) / savings (income − expense)", () => {
    // Кафе + Прочее marked optional → wants; Аренда defaults obligatory → need.
    const r = buildNeedsWants(base(), {
      "Кафе": { required: false },
      "Прочее": { required: false },
    });
    expect(r).toMatchObject({
      income: 100000,
      needs: 30000, // Аренда
      wants: 30000, // Кафе + Прочее
      savings: 40000,
    });
    expect(r.needsPct).toBeCloseTo(0.3);
    expect(r.wantsPct).toBeCloseTo(0.3);
    expect(r.savingsPct).toBeCloseTo(0.4);
  });

  it("collapses to wants-only when every category is marked optional", () => {
    const r = buildNeedsWants(base(), {
      "Аренда": { required: false },
      "Кафе": { required: false },
      "Прочее": { required: false },
    });
    expect(r.needs).toBe(0);
    expect(r.wants).toBe(60000);
    expect(r.savings).toBe(40000);
  });

  it("refunds reduce the matching bucket", () => {
    const txs = [
      tx({ kind: "income", amount: 100000, category: "Зарплата" }),
      tx({ kind: "expense", amount: 5000, category: "Кафе" }),
      tx({ kind: "refund", amount: 2000, category: "Кафе" }),
    ];
    const r = buildNeedsWants(txs, { "Кафе": { required: false } });
    expect(r.wants).toBe(3000); // 5000 spent − 2000 refunded
  });

  it("zero income → zero percentages, no divide-by-zero", () => {
    const r = buildNeedsWants(
      [tx({ kind: "expense", amount: 5000, category: "Кафе" })],
      {}
    );
    expect(r.income).toBe(0);
    expect(r.needsPct).toBe(0);
    expect(r.wantsPct).toBe(0);
    expect(r.savingsPct).toBe(0);
  });
});

describe("savingsRateSeries", () => {
  it("computes (income − expense)/income per month, newest last", () => {
    const txs = [
      tx({ kind: "income", amount: 100000, category: "Зарплата", date: "2026-01-05" }),
      tx({ kind: "expense", amount: 60000, category: "Кафе", date: "2026-01-10" }),
      tx({ kind: "income", amount: 100000, category: "Зарплата", date: "2026-02-05" }),
      tx({ kind: "expense", amount: 80000, category: "Кафе", date: "2026-02-10" }),
    ];
    const s = savingsRateSeries(txs, 12);
    expect(s).toEqual([
      { ym: "2026-01", rate: 0.4 },
      { ym: "2026-02", rate: 0.2 },
    ]);
  });

  it("limits to the last N months", () => {
    const txs = [
      tx({ kind: "income", amount: 1000, date: "2026-01-05" }),
      tx({ kind: "income", amount: 1000, date: "2026-02-05" }),
      tx({ kind: "income", amount: 1000, date: "2026-03-05" }),
    ];
    expect(savingsRateSeries(txs, 2).map((p) => p.ym)).toEqual(["2026-02", "2026-03"]);
  });

  it("month with no income → rate 0", () => {
    const s = savingsRateSeries([tx({ kind: "expense", amount: 500, date: "2026-04-10" })], 12);
    expect(s).toEqual([{ ym: "2026-04", rate: 0 }]);
  });
});

describe("savingsRateSeries — отчётный месяц", () => {
  // День 28: «2026-08» это 28.08–27.09, поэтому зарплата 28 августа и трата
  // 10 сентября дают ОДНУ точку графика, а не две календарные.
  const txs = [
    tx({ kind: "income", amount: 100000, date: "2026-08-28" }),
    tx({ kind: "expense", amount: 60000, date: "2026-09-10" }),
  ];

  it("склеивает отрезок 28.08–27.09 в одну точку", () => {
    expect(savingsRateSeries(txs, 12, 28)).toEqual([{ ym: "2026-08", rate: 0.4 }]);
  });

  it("по умолчанию (день 1) остаются два календарных месяца", () => {
    expect(savingsRateSeries(txs, 12)).toEqual([
      { ym: "2026-08", rate: 1 },
      { ym: "2026-09", rate: 0 },
    ]);
  });
});
