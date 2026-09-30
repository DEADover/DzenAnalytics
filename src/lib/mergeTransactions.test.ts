import { describe, it, expect } from "vitest";
import type { Transaction } from "../types";
import { mergeDefaults, mergeProblem, mergedTotal } from "./mergeTransactions";

let n = 0;
const tx = (over: Partial<Transaction> = {}): Transaction => ({
  id: `t${++n}`,
  date: "2026-09-01",
  category: "Инвестиции",
  subcategory: null,
  categoryFull: "Инвестиции",
  payee: "Инвесткопилка",
  comment: "",
  outcomeAccount: "Тинькофф",
  outcomeAmount: 10,
  outcomeCurrency: "RUB",
  incomeAccount: "Тинькофф",
  incomeAmount: 0,
  incomeCurrency: "RUB",
  kind: "expense",
  amount: 10,
  currency: "RUB",
  account: "Тинькофф",
  amountBase: 10,
  opAmount: null,
  opCurrency: null,
  createdAt: "2026-09-01T12:00:00.000Z",
  ...over,
});

describe("mergeProblem", () => {
  it("меньше двух — объединять нечего", () => {
    expect(mergeProblem([tx()])).toMatch(/две/);
  });

  it("операции одного счёта объединяются", () => {
    expect(mergeProblem([tx(), tx(), tx()])).toBeNull();
  });

  it("с разных счетов — нет: поменялись бы остатки", () => {
    expect(mergeProblem([tx(), tx({ account: "Сбер" })])).toMatch(/одного счёта/);
  });

  it("перевод с расходом не смешивается", () => {
    expect(mergeProblem([tx(), tx({ kind: "transfer" })])).toMatch(/Переводы/);
  });

  it("переводы — только между одной парой счетов", () => {
    const a = tx({ kind: "transfer", incomeAccount: "Копилка" });
    const b = tx({ kind: "transfer", incomeAccount: "Копилка" });
    const c = tx({ kind: "transfer", incomeAccount: "Вклад" });
    expect(mergeProblem([a, b])).toBeNull();
    expect(mergeProblem([a, c])).toMatch(/одними и теми же/);
  });

  it("в сумме ноль — нельзя", () => {
    expect(
      mergeProblem([tx({ amount: 100 }), tx({ kind: "refund", amount: 100 })])
    ).toMatch(/ноль/);
  });
});

describe("mergedTotal", () => {
  it("расходы складываются", () => {
    expect(mergedTotal([tx({ amount: 7.3 }), tx({ amount: 12.7 }), tx({ amount: 40 })])).toEqual({
      kind: "expense",
      amount: 60,
    });
  });

  it("возврат вычитается из расхода", () => {
    expect(mergedTotal([tx({ amount: 1000 }), tx({ kind: "refund", amount: 200 })])).toEqual({
      kind: "expense",
      amount: 800,
    });
  });

  it("в плюсе без доходов — возврат, а не доход", () => {
    expect(
      mergedTotal([tx({ amount: 100 }), tx({ kind: "refund", amount: 300 })])
    ).toEqual({ kind: "refund", amount: 200 });
  });

  it("в плюсе с доходом — доход", () => {
    expect(
      mergedTotal([tx({ kind: "income", amount: 500 }), tx({ kind: "income", amount: 250.5 })])
    ).toEqual({ kind: "income", amount: 750.5 });
  });

  it("у переводов обе ноги складываются отдельно", () => {
    const t = (o: number, i: number) =>
      tx({ kind: "transfer", outcomeAmount: o, incomeAmount: i, incomeAccount: "USD" });
    expect(mergedTotal([t(1000, 11), t(2000, 22.5)])).toEqual({
      kind: "transfer",
      amount: 3000,
      incomeAmount: 33.5,
    });
  });
});

describe("mergeDefaults", () => {
  it("дата — самая поздняя", () => {
    const d = mergeDefaults([
      tx({ date: "2026-09-03" }),
      tx({ date: "2026-09-07" }),
      tx({ date: "2026-09-01" }),
    ]);
    expect(d.date).toBe("2026-09-07");
  });

  it("категория и контрагент — с наибольшей суммой", () => {
    const d = mergeDefaults([
      tx({ category: "Прочее", amount: 50, payee: "Магазин" }),
      tx({ category: "Инвестиции", subcategory: "Копилка", amount: 30 }),
      tx({ category: "Инвестиции", subcategory: "Копилка", amount: 30 }),
    ]);
    expect(d.category).toBe("Инвестиции");
    expect(d.subcategory).toBe("Копилка");
    expect(d.payee).toBe("Инвесткопилка");
  });

  it("контрагент из справочника важнее текста банка", () => {
    expect(mergeDefaults([tx({ brand: "Т-Банк", payee: "TINKOFF*ROUND" })]).payee).toBe("Т-Банк");
  });

  it("комментарии — разные через «; », повторы один раз", () => {
    const d = mergeDefaults([
      tx({ comment: "неделя 1" }),
      tx({ comment: "" }),
      tx({ comment: "неделя 1" }),
      tx({ comment: "неделя 2" }),
    ]);
    expect(d.comment).toBe("неделя 1; неделя 2");
  });

  it("вторые категории собираются со всех", () => {
    const d = mergeDefaults([
      tx({ extraCategories: ["Отпуск"] }),
      tx({ extraCategories: ["Отпуск", "Турция"] }),
      tx(),
    ]);
    expect(d.extraCategories).toEqual(["Отпуск", "Турция"]);
  });

  it("у переводов категории нет", () => {
    const d = mergeDefaults([tx({ kind: "transfer" }), tx({ kind: "transfer" })]);
    expect(d.category).toBe("");
  });
});
