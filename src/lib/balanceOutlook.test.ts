import { describe, expect, it } from "vitest";
import type { ForecastOp } from "./balanceForecast";
import { buildBalanceOutlook, isEverydayAccount } from "./balanceOutlook";

const op = (
  date: string,
  kind: ForecastOp["kind"],
  amountBase: number,
  account = "card",
  toAccount: string | null = null
): ForecastOp => ({ date, kind, amountBase, toAmountBase: null, account, toAccount, title: "" });

const everyday = new Set(["card", "cash"]);
const picked = (a: string) => everyday.has(a);
const range = { from: "2026-11-01", to: "2026-11-30" };

describe("isEverydayAccount", () => {
  const a = { type: "ccard", archive: false, inBalance: true, savings: false };
  it("карты и наличные в балансе — да; накопительные, вклады, долги, архив и вне баланса — нет", () => {
    expect(isEverydayAccount(a)).toBe(true);
    expect(isEverydayAccount({ ...a, type: "cash" })).toBe(true);
    expect(isEverydayAccount({ ...a, savings: true })).toBe(false);
    expect(isEverydayAccount({ ...a, type: "deposit" })).toBe(false);
    expect(isEverydayAccount({ ...a, type: "loan" })).toBe(false);
    expect(isEverydayAccount({ ...a, type: "debt" })).toBe(false);
    expect(isEverydayAccount({ ...a, archive: true })).toBe(false);
    expect(isEverydayAccount({ ...a, inBalance: false })).toBe(false);
  });
});

describe("buildBalanceOutlook", () => {
  const series = [
    { date: "2026-10-28", net: 50_000 },
    { date: "2026-11-05", net: 40_000 },
    { date: "2026-11-18", net: 30_000 },
  ];

  it("факт до сегодня, дальше ступеньки запланированного", () => {
    const f = buildBalanceOutlook(
      series,
      range,
      "2026-11-18",
      [
        op("2026-11-20", "expense", 25_000),
        op("2026-11-25", "income", 100_000),
        // Перевод на вклад уменьшает повседневные деньги, между своими — нет.
        op("2026-11-27", "transfer", 10_000, "card", "deposit"),
        op("2026-11-27", "transfer", 7_000, "card", "cash"),
        op("2026-11-22", "expense", 999, "deposit"),
        op("2026-12-02", "expense", 5_000),
      ],
      picked
    );
    expect(f.points).toHaveLength(30);
    expect(f.now).toBe(30_000);
    // Ряд редкий: между точками остаток стоит; начало месяца — из прошлого.
    expect(f.points[0]).toMatchObject({ date: "2026-11-01", fact: 50_000, plan: null });
    expect(f.points[4].fact).toBe(40_000);
    expect(f.points[16].fact).toBe(40_000);
    // Сегодня факт и прогноз сходятся в одной точке.
    expect(f.points[17]).toMatchObject({ date: "2026-11-18", fact: 30_000, plan: 30_000 });
    expect(f.points[18]).toMatchObject({ fact: null, plan: 30_000 });
    expect(f.points[19].plan).toBe(5_000);
    expect(f.points[24].plan).toBe(105_000);
    expect(f.end).toBe(95_000);
    expect(f.min).toEqual({ date: "2026-11-20", value: 5_000 });
    expect(f.below).toBeNull();
    expect(f.out).toBe(35_000);
    expect(f.outCount).toBe(2);
    expect(f.income).toBe(100_000);
    expect(f.incomeCount).toBe(1);
    expect(f.nextIncome).toBe("2026-11-25");
  });

  it("называет день, когда остаток уходит в минус", () => {
    const f = buildBalanceOutlook(
      series,
      range,
      "2026-11-18",
      [op("2026-11-21", "expense", 38_400), op("2026-11-25", "income", 50_000)],
      picked
    );
    expect(f.min).toEqual({ date: "2026-11-21", value: -8_400 });
    expect(f.below).toBe("2026-11-21");
    expect(f.end).toBe(41_600);
  });

  it("просроченное в прогноз не идёт, план на сегодня ложится на завтра", () => {
    const f = buildBalanceOutlook(
      series,
      range,
      "2026-11-18",
      [op("2026-11-07", "expense", 100), op("2026-11-18", "expense", 300)],
      picked
    );
    expect(f.points[17].plan).toBe(30_000);
    expect(f.points[18].plan).toBe(29_700);
    expect(f.end).toBe(29_700);
    expect(f.outCount).toBe(1);
  });

  it("в последний день месяца план на сегодня входит в итог", () => {
    const f = buildBalanceOutlook(series, range, "2026-11-30", [op("2026-11-30", "expense", 100)], picked);
    expect(f.points[29]).toMatchObject({ fact: 30_000, plan: 30_000 });
    expect(f.end).toBe(29_900);
  });

  it("без планов прогноз — ровная линия от сегодняшнего остатка", () => {
    const f = buildBalanceOutlook(series, range, "2026-11-18", [], picked);
    expect(f.end).toBe(30_000);
    expect(f.min).toEqual({ date: "2026-11-18", value: 30_000 });
    expect(f.out).toBe(0);
    expect(f.nextIncome).toBeNull();
  });
});
