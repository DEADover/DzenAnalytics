import { describe, it, expect } from "vitest";
import { buildBudgetYear, yearDiff } from "./budgetYear";
import type { BudgetLine } from "./budgets";
import type { Transaction } from "../types";

let seq = 0;
function tx(p: Partial<Transaction>): Transaction {
  return {
    id: `t${++seq}`,
    date: "2026-01-15",
    amount: 0,
    amountBase: 0,
    currency: "RUB",
    kind: "expense",
    category: "Еда",
    subcategory: null,
    payee: "",
    comment: "",
    account: "Карта",
    ...(p as object),
  } as Transaction;
}

function line(p: Partial<BudgetLine>): BudgetLine {
  return {
    id: `l${++seq}`,
    category: "Еда",
    subcategory: null,
    kind: "expense",
    amount: 0,
    recurrence: "monthly",
    startMonth: "2026-01",
    endMonth: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...p,
  };
}

describe("yearDiff", () => {
  it("у расхода это остаток: план минус факт", () => {
    expect(yearDiff({ plan: 10_000, fact: 8000 }, "expense")).toBe(2000);
    expect(yearDiff({ plan: 10_000, fact: 12_000 }, "expense")).toBe(-2000);
  });

  it("у дохода наоборот: факт минус план", () => {
    // Перевыполнить план по доходу — хорошо, поэтому знак зеркальный.
    expect(yearDiff({ plan: 50_000, fact: 60_000 }, "income")).toBe(10_000);
    expect(yearDiff({ plan: 50_000, fact: 40_000 }, "income")).toBe(-10_000);
  });

  it("«больше нуля» в обоих разделах значит одно и то же — «хорошо»", () => {
    const goodExpense = yearDiff({ plan: 100, fact: 50 }, "expense");
    const goodIncome = yearDiff({ plan: 100, fact: 150 }, "income");
    expect(goodExpense).toBeGreaterThan(0);
    expect(goodIncome).toBeGreaterThan(0);
  });
});

describe("buildBudgetYear", () => {
  it("раскладывает план и факт по месяцам года", () => {
    const r = buildBudgetYear(
      [line({ amount: 10_000 })],
      [tx({ date: "2026-03-10", amountBase: 8000 })],
      2026
    );
    const g = r.expense.groups[0];
    expect(r.months).toHaveLength(12);
    expect(g.total.cells[2]).toEqual({ plan: 10_000, fact: 8000 });
    expect(g.total.cells[3]).toEqual({ plan: 10_000, fact: 0 });
    expect(g.total.plan).toBe(120_000);
    expect(g.total.fact).toBe(8000);
  });

  it("месяцы вне окна строки плана не получают", () => {
    const r = buildBudgetYear(
      [line({ amount: 10_000, startMonth: "2026-06", endMonth: "2026-07" })],
      [],
      2026
    );
    const cells = r.expense.groups[0].total.cells;
    expect(cells.map((c) => c.plan)).toEqual([0, 0, 0, 0, 0, 10_000, 10_000, 0, 0, 0, 0, 0]);
  });

  it("операции соседних лет не попадают", () => {
    const r = buildBudgetYear(
      [],
      [
        tx({ date: "2025-12-31", amountBase: 5000 }),
        tx({ date: "2027-01-01", amountBase: 5000 }),
        tx({ date: "2026-01-01", amountBase: 1000 }),
      ],
      2026
    );
    expect(r.expense.fact).toBe(1000);
  });

  it("свод категории = родитель + под-категории", () => {
    const r = buildBudgetYear(
      [
        line({ amount: 10_000 }),
        line({ subcategory: "Кафе", amount: 5000 }),
      ],
      [
        tx({ date: "2026-02-10", amountBase: 9000 }),
        tx({ date: "2026-02-11", amountBase: 4000, subcategory: "Кафе" }),
      ],
      2026
    );
    const g = r.expense.groups[0];
    expect(g.parent.cells[1]).toEqual({ plan: 10_000, fact: 9000 });
    expect(g.subs).toHaveLength(1);
    expect(g.total.cells[1]).toEqual({ plan: 15_000, fact: 13_000 });
  });

  it("статья без плана, но с тратами, в отчёт попадает", () => {
    // Годовой отчёт, где потраченного не видно, отчётом не является.
    const r = buildBudgetYear([], [tx({ date: "2026-05-01", amountBase: 3000, category: "Дом" })], 2026);
    expect(r.expense.groups.map((g) => g.category)).toEqual(["Дом"]);
    expect(r.expense.fact).toBe(3000);
  });

  it("статья без плана и без трат за год выпадает", () => {
    const r = buildBudgetYear(
      [line({ category: "Дом", amount: 0, overrides: { "2025-05": 1000 } })],
      [],
      2026
    );
    expect(r.expense.groups).toEqual([]);
  });

  it("переводы и «Без категории» не считаются", () => {
    const r = buildBudgetYear(
      [],
      [
        tx({ date: "2026-04-01", amountBase: 50_000, kind: "transfer" }),
        tx({ date: "2026-04-02", amountBase: 700, category: "Без категории" }),
      ],
      2026
    );
    expect(r.expense.groups).toEqual([]);
    expect(r.expense.fact).toBe(0);
  });

  it("возвраты уменьшают факт месяца", () => {
    const r = buildBudgetYear(
      [],
      [
        tx({ date: "2026-04-01", amountBase: 5000 }),
        tx({ date: "2026-04-02", amountBase: 2000, kind: "refund" }),
      ],
      2026
    );
    expect(r.expense.totals[3].fact).toBe(3000);
  });

  it("дельта считается помесячно по плану и по факту", () => {
    const r = buildBudgetYear(
      [line({ amount: 10_000 }), line({ category: "Зарплата", kind: "income", amount: 50_000 })],
      [
        tx({ date: "2026-01-10", amountBase: 12_000 }),
        tx({ date: "2026-01-11", amountBase: 60_000, kind: "income", category: "Зарплата" }),
      ],
      2026
    );
    expect(r.delta[0]).toEqual({ plan: 40_000, fact: 48_000 });
    expect(r.delta[1]).toEqual({ plan: 40_000, fact: 0 });
  });

  it("категории идут по убыванию факта", () => {
    const r = buildBudgetYear(
      [],
      [
        tx({ date: "2026-01-10", amountBase: 1000, category: "Еда" }),
        tx({ date: "2026-01-10", amountBase: 9000, category: "Дом" }),
      ],
      2026
    );
    expect(r.expense.groups.map((g) => g.category)).toEqual(["Дом", "Еда"]);
  });

  it("периметр счетов отсекает чужие операции, а перевод наружу становится статьёй", () => {
    const txs = [
      tx({ date: "2026-03-01", amountBase: 1000, account: "Карта" }),
      tx({ date: "2026-03-02", amountBase: 5000, account: "Наличные" }),
      tx({
        date: "2026-03-03",
        kind: "transfer",
        category: "Переводы",
        account: "Карта",
        outcomeAccount: "Карта",
        incomeAccount: "Накопительный",
        amountBase: 30_000,
      }),
    ];
    const scope = { accounts: new Set(["Карта"]), perimeterTransfers: true };
    const r = buildBudgetYear([], txs, 2026, scope);
    expect(r.expense.groups.map((g) => [g.category, g.total.fact])).toEqual([
      ["Переводы", 30_000],
      ["Еда", 1000],
    ]);
  });

  it("переводы идут первой строкой, а не по величине суммы", () => {
    // Это не статья расходов в ряду прочих, а оборот по счетам: искать его
    // где-то в середине списка по величине неудобно.
    const scope = { accounts: new Set<string>(), perimeterTransfers: true };
    const r = buildBudgetYear(
      [],
      [
        tx({ date: "2026-01-10", amountBase: 900_000, category: "Дом" }),
        tx({ date: "2026-01-11", amountBase: 500_000, category: "Еда" }),
        tx({
          date: "2026-01-12",
          kind: "transfer",
          category: "Переводы",
          account: "Карта",
          outcomeAccount: "Карта",
          incomeAccount: "Накопительный",
          amountBase: 100,
        }),
      ],
      2026,
      scope
    );
    // Сумма перевода — самая маленькая, но строка всё равно первая.
    expect(r.expense.groups.map((g) => g.category)).toEqual(["Переводы", "Дом", "Еда"]);
    expect(r.income.groups.map((g) => g.category)).toEqual(["Переводы"]);
    // Остальные — по-прежнему по убыванию факта.
    expect(r.expense.groups[1].total.fact).toBeGreaterThan(r.expense.groups[2].total.fact);
  });

  it("перевод внутри бюджета виден и в расходах, и в доходах", () => {
    const scope = { accounts: new Set<string>(), perimeterTransfers: true };
    const r = buildBudgetYear(
      [],
      [
        tx({
          date: "2026-03-03",
          kind: "transfer",
          category: "Переводы",
          account: "Карта",
          outcomeAccount: "Карта",
          incomeAccount: "Накопительный",
          amountBase: 200,
        }),
      ],
      2026,
      scope
    );
    expect(r.expense.groups.map((g) => [g.category, g.total.fact])).toEqual([["Переводы", 200]]);
    expect(r.income.groups.map((g) => [g.category, g.total.fact])).toEqual([["Переводы", 200]]);
    // Под-категория — счёт на той стороне: видно, куда ушло и откуда пришло.
    expect(r.expense.groups[0].parent.subcategory).toBeNull();
    expect(r.expense.groups[0].subs[0].subcategory).toBe("Накопительный");
    expect(r.income.groups[0].subs[0].subcategory).toBe("Карта");
  });

  it("итог считается дважды: без переводов и вместе с ними", () => {
    const scope = { accounts: new Set<string>(), perimeterTransfers: true };
    const r = buildBudgetYear(
      [],
      [
        tx({ date: "2026-03-01", amountBase: 5000 }),
        tx({
          date: "2026-03-03",
          kind: "transfer",
          category: "Переводы",
          account: "Карта",
          outcomeAccount: "Карта",
          incomeAccount: "Накопительный",
          amountBase: 200,
        }),
      ],
      2026,
      scope
    );
    // «Сколько потрачено» и «сколько прошло по счетам» — разные вопросы.
    expect(r.expense.fact).toBe(5000);
    expect(r.expense.factAll).toBe(5200);
    expect(r.expense.totals[2].fact).toBe(5000);
    expect(r.expense.totalsAll[2].fact).toBe(5200);
    // Статья «Перевод» помечена — по ней и делится итог.
    expect(r.expense.groups.find((g) => g.category === "Переводы")?.transfer).toBe(true);
    expect(r.expense.groups.find((g) => g.category === "Еда")?.transfer).toBeUndefined();
  });

  it("перевод внутри бюджета не двигает разницу", () => {
    const scope = { accounts: new Set<string>(), perimeterTransfers: true };
    const transfer = tx({
      date: "2026-03-03",
      kind: "transfer",
      category: "Переводы",
      account: "Карта",
      outcomeAccount: "Карта",
      incomeAccount: "Накопительный",
      amountBase: 200,
    });
    const without = buildBudgetYear([], [tx({ date: "2026-03-01", amountBase: 5000 })], 2026, scope);
    const withTr = buildBudgetYear(
      [],
      [tx({ date: "2026-03-01", amountBase: 5000 }), transfer],
      2026,
      scope
    );
    // Обе ноги гасят друг друга — иначе «Разница» врала бы на каждый перевод.
    expect(withTr.delta[2].fact).toBe(without.delta[2].fact);
  });

  it("перевод наружу разницу двигает — деньги действительно ушли", () => {
    const scope = { accounts: new Set(["Карта"]), perimeterTransfers: true };
    const r = buildBudgetYear(
      [],
      [
        tx({
          date: "2026-03-03",
          kind: "transfer",
          category: "Переводы",
          account: "Карта",
          outcomeAccount: "Карта",
          incomeAccount: "Чужой",
          amountBase: 200,
        }),
      ],
      2026,
      scope
    );
    expect(r.delta[2].fact).toBe(-200);
  });

  it("без настройки оба итога совпадают", () => {
    const r = buildBudgetYear([], [tx({ date: "2026-01-10", amountBase: 1000 })], 2026);
    expect(r.expense.fact).toBe(r.expense.factAll);
    expect(r.expense.totals).toEqual(r.expense.totalsAll);
  });

  it("доходы и расходы под одним тегом идут в разные разделы", () => {
    const r = buildBudgetYear(
      [],
      [
        tx({ date: "2026-01-10", amountBase: 1000, category: "Банки" }),
        tx({ date: "2026-01-11", amountBase: 1500, category: "Банки", kind: "income" }),
      ],
      2026
    );
    expect(r.expense.fact).toBe(1000);
    expect(r.income.fact).toBe(1500);
  });
});
