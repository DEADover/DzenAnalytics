import { describe, it, expect } from "vitest";
import { depositTotals, projectDeposit, type DepositTerms } from "./deposits";

const terms = (over: Partial<DepositTerms> = {}): DepositTerms => ({
  percent: 12,
  startDate: "2026-01-01",
  endDateOffset: 1,
  endDateOffsetInterval: "year",
  payoffStep: 1,
  payoffInterval: "month",
  capitalization: false,
  ...over,
});

describe("projectDeposit", () => {
  it("простой процент за год — ровно ставка", () => {
    // Миллион под 12 % на год без капитализации: 120 000 за срок.
    const p = projectDeposit(1_000_000, terms(), "2026-01-01")!;
    // Год от 1 января — это 1 января следующего.
    expect(p.endDate).toBe("2027-01-01");
    expect(p.interestTotal).toBeCloseTo(120_000, 0);
    expect(p.compounded).toBe(false);
  });

  it("капитализация даёт больше простого процента", () => {
    const simple = projectDeposit(1_000_000, terms(), "2026-01-01")!;
    const compound = projectDeposit(
      1_000_000,
      terms({ capitalization: true }),
      "2026-01-01"
    )!;
    expect(compound.compounded).toBe(true);
    // Ежемесячная капитализация под 12 % даёт около 12,68 % годовых.
    expect(compound.interestTotal).toBeGreaterThan(simple.interestTotal);
    expect(compound.interestTotal).toBeCloseTo(126_825, -2);
  });

  it("без периодичности капитализация не применяется", () => {
    // Сложный процент не от чего считать: неизвестно, как часто начисляют.
    const p = projectDeposit(
      1_000_000,
      terms({ capitalization: true, payoffStep: null, payoffInterval: null }),
      "2026-01-01"
    )!;
    expect(p.compounded).toBe(false);
    expect(p.interestTotal).toBeCloseTo(120_000, 0);
  });

  it("«ещё набежит» считается от остатка срока, а не от всего", () => {
    // Полгода позади: впереди примерно половина процентов.
    const p = projectDeposit(1_000_000, terms(), "2026-07-01")!;
    expect(p.interestLeft).toBeGreaterThan(55_000);
    expect(p.interestLeft).toBeLessThan(65_000);
    expect(p.atMaturity).toBeCloseTo(1_000_000 + p.interestLeft, 6);
  });

  it("срок вышел — не набежит ничего", () => {
    const p = projectDeposit(1_000_000, terms(), "2027-06-01")!;
    expect(p.daysLeft).toBe(0);
    expect(p.interestLeft).toBe(0);
    expect(p.atMaturity).toBe(1_000_000);
  });

  it("без ставки, срока или даты открытия — молчим, а не показываем ноль", () => {
    // Ноль означал бы «вклад ничего не принесёт», а мы просто не знаем.
    expect(projectDeposit(1_000_000, terms({ percent: null }), "2026-01-01")).toBeNull();
    expect(projectDeposit(1_000_000, terms({ startDate: null }), "2026-01-01")).toBeNull();
    expect(projectDeposit(1_000_000, terms({ endDateOffset: null }), "2026-01-01")).toBeNull();
    expect(projectDeposit(0, terms(), "2026-01-01")).toBeNull();
  });

  it("срок в месяцах считается так же, как в годах", () => {
    const year = projectDeposit(500_000, terms(), "2026-01-01")!;
    const months = projectDeposit(
      500_000,
      terms({ endDateOffset: 12, endDateOffsetInterval: "month" }),
      "2026-01-01"
    )!;
    expect(Math.abs(months.daysTotal - year.daysTotal)).toBeLessThanOrEqual(1);
  });
});

describe("depositTotals", () => {
  const row = (balance: number, percent: number) => ({
    account: null,
    balance,
    projection: projectDeposit(balance, terms({ percent }), "2026-01-01")!,
  });

  it("средняя ставка взвешена остатком, а не арифметическая", () => {
    // Миллион под 20 % и тысяча под 5 %: средняя почти 20 %, а не 12,5 %.
    const t = depositTotals([row(1_000_000, 20), row(1_000, 5)]);
    expect(t.avgPercent).toBeGreaterThan(19.9);
    expect(t.balance).toBe(1_001_000);
  });

  it("итог на конец срока — остаток плюс то, что ещё набежит", () => {
    const rows = [row(1_000_000, 12), row(500_000, 10)];
    const t = depositTotals(rows);
    expect(t.atMaturity).toBeCloseTo(t.balance + t.interestLeft, 6);
    // Остаток срока меряется календарными днями, поэтому чуть меньше
    // договорных 170 000: 365 дней против 365,25 в году.
    expect(t.interestLeft).toBeCloseTo(120_000 + 50_000, -3);
  });

  it("пустой список не делит на ноль", () => {
    const t = depositTotals([]);
    expect(t.avgPercent).toBe(0);
    expect(t.atMaturity).toBe(0);
  });
});
