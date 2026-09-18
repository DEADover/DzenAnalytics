import { describe, it, expect } from "vitest";
import { computeWhatIfBase, avgMonthlyByCategory } from "./whatif";
import { tx } from "../test/fixtures";

// День 28: отчётный месяц «2026-08» это 28.08–27.09. Обе операции попадают в
// него, и средние делятся на ОДИН месяц. По календарю это два месяца — и все
// базовые цифры сценария оказываются вдвое меньше.
const txs = [
  tx({ kind: "income", amount: 120000, date: "2026-08-28" }),
  tx({ kind: "expense", amount: 60000, category: "Кафе", date: "2026-09-10" }),
];

describe("computeWhatIfBase — месяц отчётный", () => {
  it("считает средние по отрезку 28.08–27.09", () => {
    const b = computeWhatIfBase(txs, 28);
    expect(b.avgIncome).toBeCloseTo(120000, 5);
    expect(b.avgExpense).toBeCloseTo(60000, 5);
    expect(b.avgSavings).toBeCloseTo(60000, 5);
  });

  it("по умолчанию (день 1) считает по календарным месяцам", () => {
    const b = computeWhatIfBase(txs);
    expect(b.avgIncome).toBeCloseTo(60000, 5);
    expect(b.avgExpense).toBeCloseTo(30000, 5);
  });
});

describe("avgMonthlyByCategory — месяц отчётный", () => {
  const spend = [
    tx({ kind: "income", amount: 100000, date: "2026-08-28" }),
    tx({ kind: "expense", amount: 6000, category: "Кафе", date: "2026-09-05" }),
  ];

  it("делит трату на один отчётный месяц, а не на два календарных", () => {
    expect(avgMonthlyByCategory(spend, 8, 28)).toEqual([
      { category: "Кафе", monthly: 6000 },
    ]);
  });

  it("по умолчанию (день 1) месяцев два", () => {
    expect(avgMonthlyByCategory(spend, 8)).toEqual([
      { category: "Кафе", monthly: 3000 },
    ]);
  });
});
