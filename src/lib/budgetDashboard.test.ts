import { describe, it, expect } from "vitest";
import {
  achievement,
  atMonth,
  buildBudgetDashboard,
  growth,
  prevMonth,
  variance,
  ytd,
} from "./budgetDashboard";
import { buildBudgetYear } from "./budgetYear";
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

const empty = () => buildBudgetYear([], [], 2025);

describe("achievement", () => {
  it("делит факт на план", () => {
    expect(achievement(9600, 10_000)).toBeCloseTo(0.96);
  });

  it("без плана процента нет", () => {
    // Ноль или сто процентов здесь одинаково врут — честнее прочерк.
    expect(achievement(5000, 0)).toBeNull();
  });
});

describe("growth", () => {
  it("считает рост к базе", () => {
    expect(growth(110, 100)).toBeCloseTo(0.1);
    expect(growth(90, 100)).toBeCloseTo(-0.1);
  });

  it("без базы роста нет", () => {
    expect(growth(100, 0)).toBeNull();
  });
});

describe("variance", () => {
  it("у расхода это остаток, у дохода — перевыполнение", () => {
    expect(variance(8000, 10_000, "expense")).toBe(2000);
    expect(variance(60_000, 50_000, "income")).toBe(10_000);
  });
});

describe("buildBudgetDashboard", () => {
  it("месяц берёт из выбранного, а «с начала года» — накопительно", () => {
    const r = buildBudgetYear(
      [line({ amount: 10_000 })],
      [
        tx({ date: "2026-01-10", amountBase: 1000 }),
        tx({ date: "2026-02-10", amountBase: 2000 }),
        tx({ date: "2026-03-10", amountBase: 4000 }),
        tx({ date: "2026-09-10", amountBase: 9000 }),
      ],
      2026
    );
    const d = buildBudgetDashboard(r, empty(), 2); // март
    expect(d.month).toBe("2026-03");
    expect(atMonth(d.expense.factByMonth, 2)).toBe(4000);
    // Сентябрь в «с начала года» не входит — иначе март сравнивался бы с годом.
    expect(ytd(d.expense.factByMonth, 2)).toBe(7000);
    expect(ytd(d.expense.planByMonth, 2)).toBe(30_000);
    // Сырьё отдаётся целиком: месяц выбирается уже в Excel.
    expect(d.expense.factByMonth).toHaveLength(12);
    expect(atMonth(d.expense.factByMonth, 8)).toBe(9000);
  });

  it("прошлый год берётся тем же отрезком", () => {
    const cur = buildBudgetYear([], [tx({ date: "2026-02-01", amountBase: 500 })], 2026);
    const prev = buildBudgetYear(
      [],
      [
        tx({ date: "2025-01-01", amountBase: 100 }),
        tx({ date: "2025-02-01", amountBase: 200 }),
        tx({ date: "2025-11-01", amountBase: 900 }),
      ],
      2025
    );
    const d = buildBudgetDashboard(cur, prev, 1); // февраль
    expect(ytd(d.expense.prevFactByMonth, 1)).toBe(300);
    expect(atMonth(d.expense.prevFactByMonth, 1)).toBe(200);
  });

  it("в январе предыдущий месяц — декабрь прошлого года", () => {
    // Иначе рост «месяц к месяцу» в январе всегда пустой, а он есть.
    const cur = buildBudgetYear([], [tx({ date: "2026-01-10", amountBase: 1100 })], 2026);
    const prev = buildBudgetYear([], [tx({ date: "2025-12-10", amountBase: 1000 })], 2025);
    const d = buildBudgetDashboard(cur, prev, 0);
    const r0 = d.rows[0];
    expect(prevMonth(r0.factByMonth, r0.prevFactByMonth, 0)).toBe(1000);
    expect(
      growth(atMonth(r0.factByMonth, 0), prevMonth(r0.factByMonth, r0.prevFactByMonth, 0))
    ).toBeCloseTo(0.1);
  });

  it("порядок статей не зависит от выбранного месяца", () => {
    // Месяц переключается уже в Excel, а строки на листе записаны один раз:
    // сортировка под месяц выгрузки означала бы разный порядок при разных
    // выгрузках одного и того же года.
    const r = buildBudgetYear(
      [],
      [
        tx({ date: "2026-01-10", amountBase: 5000, category: "Еда" }),
        tx({ date: "2026-11-10", amountBase: 90_000, category: "Дом" }),
        tx({ date: "2026-02-10", amountBase: 1000, category: "Дом" }),
      ],
      2026
    );
    const march = buildBudgetDashboard(r, empty(), 2).rows.map((x) => x.category);
    const december = buildBudgetDashboard(r, empty(), 11).rows.map((x) => x.category);
    expect(march).toEqual(["Дом", "Еда"]);
    expect(december).toEqual(march);
  });

  it("берёт ВСЕ статьи, а не верхушку списка", () => {
    const txs = Array.from({ length: 15 }, (_, i) =>
      tx({ date: "2026-01-10", amountBase: (i + 1) * 100, category: `К${i}` })
    );
    const d = buildBudgetDashboard(buildBudgetYear([], txs, 2026), empty(), 0);
    expect(d.rows).toHaveLength(15);
    expect(d.rows.map((r) => r.category)).toContain("К14");
  });

  it("порядок статей берётся из годового свода, а не считается заново", () => {
    // Дашборд собран из той же таблицы, что и на экране: своя сортировка тут
    // означала бы, что отчёт и таблица идут в разном порядке (issue #68).
    const txs = [
      tx({ date: "2026-01-10", amountBase: 1000, category: "Еда" }),
      tx({ date: "2026-01-10", amountBase: 9000, category: "Дом" }),
    ];
    const byAmount = buildBudgetYear([], txs, 2026, undefined, "amount");
    expect(buildBudgetDashboard(byAmount, empty(), 0).rows.map((r) => r.category)).toEqual([
      "Дом",
      "Еда",
    ]);
    const byAlpha = buildBudgetYear([], txs, 2026, undefined, "alpha");
    expect(buildBudgetDashboard(byAlpha, empty(), 0).rows.map((r) => r.category)).toEqual([
      "Дом",
      "Еда",
    ]);
  });

  it("под-категории идут следом за своей категорией", () => {
    const r = buildBudgetYear(
      [],
      [
        tx({ date: "2026-01-10", amountBase: 1000, category: "Еда" }),
        tx({ date: "2026-01-11", amountBase: 4000, category: "Еда", subcategory: "Кафе" }),
        tx({ date: "2026-01-12", amountBase: 2000, category: "Еда", subcategory: "Продукты" }),
        tx({ date: "2026-01-13", amountBase: 900, category: "Дом" }),
      ],
      2026
    );
    const d = buildBudgetDashboard(r, empty(), 0);
    expect(d.rows.map((x) => x.label)).toEqual([
      "Дом",
      "Еда",
      "Еда · Кафе",
      "Еда · Продукты",
    ]);
    // Строка категории — это её ИТОГ вместе с под-категориями.
    expect(atMonth(d.rows[1].factByMonth, 0)).toBe(7000);
    expect(d.rows[1].subcategory).toBeNull();
    expect(d.rows[2].subcategory).toBe("Кафе");
  });

  it("под-категории прошлого года ищутся по паре «категория + под-категория»", () => {
    // «Кафе» может быть и у «Еды», и у «Развлечений» — ключа из одного имени мало.
    const cur = buildBudgetYear(
      [],
      [tx({ date: "2026-01-10", amountBase: 100, category: "Еда", subcategory: "Кафе" })],
      2026
    );
    const prev = buildBudgetYear(
      [],
      [
        tx({ date: "2025-01-10", amountBase: 900, category: "Развлечения", subcategory: "Кафе" }),
        tx({ date: "2025-01-11", amountBase: 50, category: "Еда", subcategory: "Кафе" }),
      ],
      2025
    );
    const d = buildBudgetDashboard(cur, prev, 0);
    const sub = d.rows.find((r) => r.label === "Еда · Кафе")!;
    expect(ytd(sub.prevFactByMonth, 0)).toBe(50);
  });

  it("статья с движением в любом месяце года остаётся в наборе", () => {
    // Отбор идёт по ГОДУ, а не по месяцу выгрузки: иначе при переключении
    // месяца в Excel у строки не оказалось бы данных.
    const r = buildBudgetYear(
      [],
      [
        tx({ date: "2026-01-10", amountBase: 100, category: "Еда" }),
        tx({ date: "2026-12-10", amountBase: 900, category: "Дом" }),
      ],
      2026
    );
    const d = buildBudgetDashboard(r, empty(), 0);
    expect(d.rows.map((x) => x.category)).toEqual(["Дом", "Еда"]);
    expect(atMonth(d.rows[0].factByMonth, 11)).toBe(900);
  });

  it("статья без единого движения за год выпадает", () => {
    const r = buildBudgetYear([], [tx({ date: "2026-01-10", amountBase: 100 })], 2026);
    const d = buildBudgetDashboard(r, empty(), 0);
    expect(d.rows.map((x) => x.category)).toEqual(["Еда"]);
  });

  it("сырьё раздела отдаётся и с переводами, и без", () => {
    const scope = { accounts: new Set<string>(), perimeterTransfers: true };
    const r = buildBudgetYear(
      [],
      [
        tx({ date: "2026-01-10", amountBase: 30_000 }),
        tx({
          date: "2026-01-12",
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
    const d = buildBudgetDashboard(r, empty(), 0);
    expect(atMonth(d.expense.factByMonth, 0)).toBe(30_000);
    expect(atMonth(d.expense.factAllByMonth, 0)).toBe(30_200);
    expect(d.expense.hasTransfers).toBe(true);
    expect(d.income.hasTransfers).toBe(true);
  });

  it("разделы идут расходами, доходами и переводами в конце", () => {
    const scope = { accounts: new Set<string>(), perimeterTransfers: true };
    const r = buildBudgetYear(
      [],
      [
        tx({ date: "2026-01-10", amountBase: 30_000, category: "Еда" }),
        tx({ date: "2026-01-11", amountBase: 90_000, kind: "income", category: "Зарплата" }),
        tx({
          date: "2026-01-12",
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
    const d = buildBudgetDashboard(r, empty(), 0);
    expect(d.sections.map((s) => s.title)).toEqual(["Расходы", "Доходы", "Переводы"]);
    expect(d.sections[0].rows.map((x) => x.label)).toEqual(["Еда"]);
    expect(d.sections[1].rows.map((x) => x.label)).toEqual(["Зарплата"]);
    // Переводы собраны с обеих сторон: списание и зачисление — разные строки.
    expect(d.sections[2].rows.map((x) => x.label)).toEqual([
      "Переводы — списания",
      "Списание · Накопительный",
      "Переводы — зачисления",
      "Зачисление · Карта",
    ]);
    expect(d.sections[1].rows[0].kind).toBe("income");
  });

  it("пустого раздела в дашборде нет", () => {
    const r = buildBudgetYear([], [tx({ date: "2026-01-10", amountBase: 100 })], 2026);
    expect(buildBudgetDashboard(r, empty(), 0).sections.map((s) => s.key)).toEqual(["expense"]);
  });

  it("переводы в расходах остаются последней строкой листа Excel", () => {
    const scope = { accounts: new Set<string>(), perimeterTransfers: true };
    const r = buildBudgetYear(
      [],
      [
        tx({ date: "2026-01-10", amountBase: 30_000, category: "Яхта" }),
        tx({
          date: "2026-01-12",
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
    const labels = buildBudgetDashboard(r, empty(), 0).rows.map((x) => x.label);
    expect(labels[0]).toBe("Яхта");
    expect(labels[labels.length - 2]).toBe("Переводы");
  });

  it("прошлый год у доходов не путается с одноимённой статьёй расходов", () => {
    // «Банки» бывают и расходом (комиссии), и доходом (проценты).
    const cur = buildBudgetYear(
      [],
      [tx({ date: "2026-01-10", amountBase: 100, kind: "income", category: "Банки" })],
      2026
    );
    const prev = buildBudgetYear(
      [],
      [
        tx({ date: "2025-01-10", amountBase: 700, category: "Банки" }),
        tx({ date: "2025-01-11", amountBase: 40, kind: "income", category: "Банки" }),
      ],
      2025
    );
    const d = buildBudgetDashboard(cur, prev, 0);
    const income = d.sections.find((s) => s.key === "income")!.rows[0];
    expect(ytd(income.prevFactByMonth, 0)).toBe(40);
  });

  it("месяц за пределами года прижимается к границе", () => {
    const r = buildBudgetYear([], [tx({ date: "2026-12-10", amountBase: 10 })], 2026);
    expect(buildBudgetDashboard(r, empty(), 99).monthIndex).toBe(11);
    expect(buildBudgetDashboard(r, empty(), -3).monthIndex).toBe(0);
  });
});
