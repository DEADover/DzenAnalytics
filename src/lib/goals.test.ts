import { describe, it, expect } from "vitest";
import { currenciesToQuote, goalProgress, goalSources, toBaseNow, type GoalAccount } from "./goals";
import type { CurrencyRates } from "../types";

const rub: CurrencyRates = { base: "RUB", rates: { RUB: 1, USD: 90, EUR: 100 } };
const cbr = { USD: 80, EUR: 95 };

const acc = (title: string, balance: number, currency = "RUB"): GoalAccount => ({
  title,
  balance,
  currency,
  savings: true,
});

describe("источники цели", () => {
  it("старая цель с одним счётом читается как список из одного", () => {
    expect(goalSources({ accountTitle: "Вклад" })).toEqual(["Вклад"]);
  });

  it("список важнее старого поля и без повторов", () => {
    expect(goalSources({ accountTitle: "Вклад", accountTitles: ["Копилка", "Копилка", "Вклад"] })).toEqual([
      "Копилка",
      "Вклад",
    ]);
  });

  it("без счетов — ручная сумма", () => {
    expect(goalSources({ accountTitle: null, accountTitles: [] })).toEqual([]);
  });
});

describe("курс ЦБ на сегодня", () => {
  it("валюта в рублёвую базу — по ЦБ, а не по курсу из настроек", () => {
    expect(toBaseNow(100, "USD", rub, cbr)).toBe(8000);
  });

  it("нерублёвая база — перекрёстно через рубль", () => {
    const usd: CurrencyRates = { base: "USD", rates: { USD: 1 } };
    expect(toBaseNow(9500, "RUB", usd, cbr)).toBeCloseTo(118.75);
    expect(toBaseNow(80, "EUR", usd, cbr)).toBeCloseTo(95);
  });

  it("нет курса ЦБ — берём курс из настроек", () => {
    expect(toBaseNow(10, "USD", rub, {})).toBe(900);
  });

  it("котировать нужно валюты счетов и нерублёвую базу", () => {
    expect(currenciesToQuote([acc("a", 1, "USD"), acc("b", 1)], "EUR")).toEqual(["EUR", "USD"]);
  });
});

describe("прогресс цели", () => {
  const accounts = [acc("Вклад", 100_000), acc("Доллары", 500, "USD"), acc("Копилка", 20_000)];

  it("складывает все счета в базовой валюте", () => {
    const p = goalProgress({ current: 0, accountTitles: ["Вклад", "Доллары"] }, accounts, rub, cbr);
    expect(p.current).toBe(140_000);
    expect(p.bound).toBe(true);
    expect(p.sources.map((s) => s.balanceBase)).toEqual([100_000, 40_000]);
  });

  it("пропавший счёт не обнуляет цель", () => {
    const p = goalProgress({ current: 5, accountTitles: ["Вклад", "Закрытый"] }, accounts, rub, cbr);
    expect(p.current).toBe(100_000);
    expect(p.missing).toEqual(["Закрытый"]);
  });

  it("не нашлось ни одного счёта — ручная сумма", () => {
    const p = goalProgress({ current: 7_000, accountTitles: ["Закрытый"] }, accounts, rub, cbr);
    expect(p.current).toBe(7_000);
    expect(p.bound).toBe(false);
  });

  it("без счетов — ручная сумма", () => {
    expect(goalProgress({ current: 3_000 }, accounts, rub, cbr).current).toBe(3_000);
  });
});
