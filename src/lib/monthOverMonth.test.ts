import { describe, it, expect } from "vitest";
import { isImprovement, monthOverMonth } from "./monthOverMonth";
import type { Transaction } from "../types";

let seq = 0;
const tx = (date: string, amount: number, kind: Transaction["kind"] = "expense"): Transaction =>
  ({
    id: `t${++seq}`,
    date,
    category: "Еда",
    subcategory: null,
    categoryFull: "Еда",
    payee: "Магазин",
    comment: "",
    outcomeAccount: kind === "expense" ? "Карта" : "",
    outcomeAmount: kind === "expense" ? amount : 0,
    outcomeCurrency: "RUB",
    incomeAccount: kind === "income" ? "Карта" : "",
    incomeAmount: kind === "income" ? amount : 0,
    incomeCurrency: "RUB",
    kind,
    amount,
    currency: "RUB",
    account: "Карта",
    amountBase: amount,
    opAmount: null,
    opCurrency: null,
    createdAt: `${date}T12:00:00`,
  }) as Transaction;

describe("monthOverMonth", () => {
  it("два законченных месяца сравниваются целиком", () => {
    const txs = [
      tx("2026-07-05", 100_000, "income"),
      tx("2026-07-20", 40_000),
      tx("2026-06-05", 80_000, "income"),
      tx("2026-06-20", 50_000),
    ];
    // Данные кончаются 31 июля — июль закончен, подрезать нечего.
    const m = monthOverMonth(txs, "2026-07", 1, "2026-07-31");
    expect(m.running).toBe(false);
    expect(m.now).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    expect(m.prev).toEqual({ from: "2026-06-01", to: "2026-06-30" });
    expect(m.income.now).toBe(100_000);
    expect(m.income.prev).toBe(80_000);
    expect(m.expense.now).toBe(40_000);
    expect(m.net.now).toBe(60_000);
  });

  it("идущий месяц сравнивается с таким же куском прошлого", () => {
    // 10 августа. От июля берём тоже по 10-е — иначе целый июль против
    // десяти дней августа выглядел бы обвалом.
    const txs = [
      tx("2026-08-05", 30_000),
      tx("2026-08-20", 90_000), // за окном: данных по эту дату ещё нет
      tx("2026-07-05", 25_000),
      tx("2026-07-20", 60_000), // тоже за окном — июль подрезан по 10-е
    ];
    const m = monthOverMonth(txs, "2026-08", 1, "2026-08-10");
    expect(m.running).toBe(true);
    expect(m.now).toEqual({ from: "2026-08-01", to: "2026-08-10" });
    expect(m.prev).toEqual({ from: "2026-07-01", to: "2026-07-10" });
    expect(m.days).toBe(10);
    expect(m.daysInMonth).toBe(31);
    expect(m.expense.now).toBe(30_000);
    expect(m.expense.prev).toBe(25_000);
  });

  it("своё начало месяца сдвигает оба окна", () => {
    const m = monthOverMonth([], "2026-08", 11, "2026-09-10");
    expect(m.now).toEqual({ from: "2026-08-11", to: "2026-09-10" });
    expect(m.prev).toEqual({ from: "2026-07-11", to: "2026-08-10" });
  });

  it("считает разницу и в единицах, и долей", () => {
    const txs = [
      tx("2026-07-05", 110_000, "income"),
      tx("2026-06-05", 100_000, "income"),
    ];
    const m = monthOverMonth(txs, "2026-07", 1, "2026-07-31");
    expect(m.income.delta).toBe(10_000);
    expect(m.income.ratio).toBeCloseTo(0.1, 6);
  });

  it("от нуля процент не считается", () => {
    // Ноль вместо `null` читался бы как «не изменилось», хотя изменилось
    // с нуля до чего угодно.
    const m = monthOverMonth([tx("2026-07-05", 5_000)], "2026-07", 1, "2026-07-31");
    expect(m.expense.prev).toBe(0);
    expect(m.expense.ratio).toBeNull();
    expect(m.expense.delta).toBe(5_000);
  });

  it("норма сбережений — доля от дохода, без дохода это ноль", () => {
    const txs = [
      tx("2026-07-05", 100_000, "income"),
      tx("2026-07-20", 20_000),
    ];
    const m = monthOverMonth(txs, "2026-07", 1, "2026-07-31");
    expect(m.savingsRate.now).toBeCloseTo(0.8, 6);
    // В июне не было ничего: делить не на что, но и падать нельзя.
    expect(m.savingsRate.prev).toBe(0);
  });

  it("возврат уменьшает расход, а не добавляется в доход", () => {
    const txs = [tx("2026-07-05", 10_000), tx("2026-07-06", 3_000, "refund")];
    const m = monthOverMonth(txs, "2026-07", 1, "2026-07-31");
    expect(m.expense.now).toBe(7_000);
    expect(m.income.now).toBe(0);
  });

  it("переводы между своими счетами не считаются ни доходом, ни расходом", () => {
    const txs = [tx("2026-07-05", 50_000, "transfer"), tx("2026-07-06", 10_000)];
    const m = monthOverMonth(txs, "2026-07", 1, "2026-07-31");
    expect(m.expense.now).toBe(10_000);
    expect(m.income.now).toBe(0);
  });

  it("пустая история не роняет расчёт", () => {
    const m = monthOverMonth([], "2026-08", 1, "2026-08-10");
    expect(m.income.now).toBe(0);
    expect(m.income.ratio).toBeNull();
    expect(m.savingsRate.now).toBe(0);
  });
});

describe("isImprovement", () => {
  it("у расходов «меньше» — это лучше", () => {
    // Без этого виджет красил бы упавшие траты в красный.
    expect(isImprovement({ now: 5, prev: 9, delta: -4, ratio: -0.44 }, true)).toBe(true);
    expect(isImprovement({ now: 9, prev: 5, delta: 4, ratio: 0.8 }, true)).toBe(false);
  });

  it("у доходов наоборот", () => {
    expect(isImprovement({ now: 9, prev: 5, delta: 4, ratio: 0.8 }, false)).toBe(true);
    expect(isImprovement({ now: 5, prev: 9, delta: -4, ratio: -0.44 }, false)).toBe(false);
  });

  it("не изменилось — не хорошо и не плохо", () => {
    expect(isImprovement({ now: 5, prev: 5, delta: 0, ratio: 0 }, true)).toBeNull();
  });
});
