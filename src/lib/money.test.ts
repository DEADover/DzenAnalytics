import { describe, expect, it } from "vitest";
import { roundMoney, sumMoney } from "./money";

describe("roundMoney", () => {
  it("округляет пересчитанную валюту до копейки", () => {
    expect(roundMoney(606.4932 * 82.2281)).toBe(49870.78);
  });
  it("половину копейки — от нуля, в обе стороны", () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(-1.005)).toBe(-1.01);
  });
  it("целые и нечисла не трогает", () => {
    expect(roundMoney(100)).toBe(100);
    expect(Number.isNaN(roundMoney(NaN))).toBe(true);
  });
});

describe("sumMoney", () => {
  it("убирает двоичный хвост суммы", () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
  });
  it("сумма округлённых строк совпадает с итогом", () => {
    const rows = [606.4932 * 82.2281, 5.08, 2127.77, 136650.7].map(roundMoney);
    expect(sumMoney(rows)).toBe(188654.33);
  });
});
