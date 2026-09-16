import { describe, it, expect } from "vitest";
import { validateOperation, type OperationInput } from "./operationValidation";

const base: OperationInput = {
  kind: "expense",
  isDebt: false,
  amount: 100,
  payee: "",
  realAcc: "",
  outAcc: "",
  inAcc: "",
  category: "Еда",
  categoryHasIncome: false,
};
const v = (over: Partial<OperationInput>) => validateOperation({ ...base, ...over });

describe("validateOperation", () => {
  it("passes a plain valid expense", () => {
    expect(v({})).toBeNull();
  });

  it("rejects amount ≤ 0 for every kind", () => {
    expect(v({ amount: 0 })).toMatch(/больше нуля/);
    expect(v({ amount: -5 })).toMatch(/больше нуля/);
    expect(v({ amount: NaN })).toMatch(/больше нуля/);
  });

  // issue #19.8 — transfer validations
  it("refuses a transfer to the same account", () => {
    expect(v({ kind: "transfer", outAcc: "Карта", inAcc: "Карта" })).toMatch(/тот же счёт/);
  });
  it("requires both transfer legs", () => {
    expect(v({ kind: "transfer", outAcc: "Карта", inAcc: "" })).toMatch(/оба счёта/);
  });
  it("passes a transfer between two different accounts", () => {
    expect(v({ kind: "transfer", outAcc: "Карта", inAcc: "Наличные" })).toBeNull();
  });

  // issue #19.7 — debt requires a counterparty
  it("requires a payee for a debt op", () => {
    expect(v({ isDebt: true, realAcc: "Карта", payee: "" })).toMatch(/плательщик/i);
  });
  it("requires a real account for a debt op", () => {
    expect(v({ isDebt: true, realAcc: "", payee: "Иван" })).toMatch(/счёт/i);
  });
  it("passes a debt op with payee + account", () => {
    expect(v({ isDebt: true, realAcc: "Карта", payee: "Иван" })).toBeNull();
  });

  // issue #19.2 — refund must be expense-only, never a dual category
  it("refuses a refund on an income-capable (dual) category", () => {
    expect(v({ kind: "refund", category: "Корректировка", categoryHasIncome: true })).toMatch(
      /Возврат возможен только по расходной/
    );
  });
  it("allows a refund on an expense-only category", () => {
    expect(v({ kind: "refund", category: "Еда", categoryHasIncome: false })).toBeNull();
  });

  // issue #19.8 — leftover «Перевод»/«Долг» pseudo-category on a single-leg op
  it("refuses a synthetic pseudo-category on income/expense/refund", () => {
    expect(v({ kind: "income", category: "Перевод" })).toMatch(/служебная категория/);
    expect(v({ kind: "expense", category: "Долг" })).toMatch(/служебная категория/);
  });
  it("allows an empty category («Без категории»)", () => {
    expect(v({ kind: "expense", category: "" })).toBeNull();
  });
});

describe("validateOperation — «Возврат» → «Доход»", () => {
  it("доход по только расходной категории не сохраняется: Дзен-мани запишет его возвратом", () => {
    expect(v({ kind: "income", category: "Продукты", categoryExpenseOnly: true })).toMatch(
      /доходной категории/
    );
  });
  it("доход по доходной, двойной категории или без категории проходит", () => {
    expect(v({ kind: "income", category: "Зарплата", categoryHasIncome: true })).toBeNull();
    expect(
      v({ kind: "income", category: "Разное", categoryHasIncome: true, categoryExpenseOnly: false })
    ).toBeNull();
    expect(v({ kind: "income", category: "", categoryExpenseOnly: false })).toBeNull();
  });
  it("без справочника (CSV) проверка молчит", () => {
    expect(v({ kind: "income", category: "Продукты" })).toBeNull();
  });
  it("возврат по расходной категории по-прежнему проходит", () => {
    expect(v({ kind: "refund", category: "Продукты", categoryExpenseOnly: true })).toBeNull();
  });
});
