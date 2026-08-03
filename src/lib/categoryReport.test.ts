import { describe, it, expect } from "vitest";
import { buildCategoryReport, scaleKey } from "./categoryReport";
import type { Transaction } from "../types";

function tx(p: Partial<Transaction> & { date: string; amountBase: number }): Transaction {
  return {
    id: Math.random().toString(36).slice(2),
    category: p.category ?? "Еда",
    subcategory: p.subcategory ?? null,
    categoryFull: p.categoryFull ?? (p.subcategory ? `${p.category} / ${p.subcategory}` : p.category ?? "Еда"),
    payee: "",
    comment: "",
    outcomeAccount: "Карта",
    outcomeAmount: 0,
    outcomeCurrency: "RUB",
    incomeAccount: "",
    incomeAmount: 0,
    incomeCurrency: "RUB",
    kind: p.kind ?? "expense",
    amount: p.amountBase,
    currency: "RUB",
    account: "Карта",
    opAmount: null,
    opCurrency: null,
    createdAt: `${p.date}T00:00:00Z`,
    ...p,
  } as Transaction;
}

describe("categoryReport — шкала периодов", () => {
  it("месяц / квартал / год / всего", () => {
    expect(scaleKey("2026-07-30", "month", 1)).toBe("2026-07");
    expect(scaleKey("2026-07-30", "quarter", 1)).toBe("2026-Q3");
    expect(scaleKey("2026-01-30", "quarter", 1)).toBe("2026-Q1");
    expect(scaleKey("2026-07-30", "year", 1)).toBe("2026");
    expect(scaleKey("2026-07-30", "total", 1)).toBe("all");
  });

  it("учитывает свой день начала периода", () => {
    // Период начинается 11-го: 5 августа ещё относится к июльскому периоду.
    expect(scaleKey("2026-08-05", "month", 11)).toBe("2026-07");
    expect(scaleKey("2026-08-15", "month", 11)).toBe("2026-08");
  });
});

describe("categoryReport — сборка таблицы", () => {
  it("делит на доходы и расходы, переводы игнорирует", () => {
    const r = buildCategoryReport(
      [
        tx({ date: "2026-07-01", amountBase: 100, kind: "expense", category: "Еда" }),
        tx({ date: "2026-07-02", amountBase: 500, kind: "income", category: "Зарплата" }),
        tx({ date: "2026-07-03", amountBase: 999, kind: "transfer", category: "Перевод" }),
      ],
      "month"
    );
    expect(r.incomeTotal).toBe(500);
    expect(r.expenseTotal).toBe(100);
    expect(r.netTotal).toBe(400);
    expect(r.expense.map((x) => x.label)).toEqual(["Еда"]);
    expect(r.income.map((x) => x.label)).toEqual(["Зарплата"]);
  });

  it("возврат гасит трату, а не превращается в доход", () => {
    const r = buildCategoryReport(
      [
        tx({ date: "2026-07-01", amountBase: 300, kind: "expense", category: "Одежда" }),
        tx({ date: "2026-07-05", amountBase: 100, kind: "refund", category: "Одежда" }),
      ],
      "month"
    );
    expect(r.expenseTotal).toBe(200);
    expect(r.incomeTotal).toBe(0);
  });

  it("подкатегории вложены в родителя, сумма родителя включает их", () => {
    const r = buildCategoryReport(
      [
        tx({ date: "2026-07-01", amountBase: 100, category: "Еда", subcategory: "Кафе" }),
        tx({ date: "2026-07-02", amountBase: 250, category: "Еда", subcategory: "Продукты" }),
        // Операция на самом родителе, без подкатегории.
        tx({ date: "2026-07-03", amountBase: 50, category: "Еда" }),
      ],
      "month"
    );
    const [parent, ...kids] = r.expense;
    expect(parent.label).toBe("Еда");
    expect(parent.depth).toBe(0);
    expect(parent.total).toBe(400);
    expect(parent.ownTotal).toBe(50);
    // По алфавиту, а не по сумме: «Кафе» дешевле «Продуктов», но идёт первым.
    expect(kids.map((k) => [k.label, k.total, k.depth])).toEqual([
      ["Кафе", 100, 1],
      ["Продукты", 250, 1],
    ]);
    // Итог группы = сумма родительских строк, дети не считаются дважды.
    expect(r.expenseTotal).toBe(400);
  });

  it("столбцы идут по возрастанию и только там, где есть операции", () => {
    const r = buildCategoryReport(
      [
        tx({ date: "2026-09-01", amountBase: 10 }),
        tx({ date: "2026-07-01", amountBase: 20 }),
      ],
      "month"
    );
    expect(r.columns.map((c) => c.key)).toEqual(["2026-07", "2026-09"]);
    expect(r.expense[0].values).toEqual([20, 10]);
  });

  it("«Без категории» уезжает в конец списка", () => {
    const r = buildCategoryReport(
      [
        tx({ date: "2026-07-01", amountBase: 10, category: "Без категории" }),
        tx({ date: "2026-07-01", amountBase: 5, category: "Еда" }),
      ],
      "month"
    );
    expect(r.expense.map((x) => x.label)).toEqual(["Еда", "Без категории"]);
  });

  it("шкала «Всего» схлопывает историю в один столбец", () => {
    const r = buildCategoryReport(
      [
        tx({ date: "2020-01-01", amountBase: 10 }),
        tx({ date: "2026-07-01", amountBase: 15 }),
      ],
      "total"
    );
    expect(r.columns).toHaveLength(1);
    expect(r.columns[0].label).toBe("За всё время");
    expect(r.expense[0].values).toEqual([25]);
  });

  it("пустой набор операций даёт пустой отчёт, а не падение", () => {
    const r = buildCategoryReport([], "month");
    expect(r.columns).toEqual([]);
    expect(r.income).toEqual([]);
    expect(r.expense).toEqual([]);
    expect(r.netTotal).toBe(0);
  });
});

describe("categoryReport — порядок строк", () => {
  it("строки идут по алфавиту, а не по сумме", () => {
    const t = [
      tx({ date: "2026-07-01", amountBase: 1, category: "Автомобиль" }),
      tx({ date: "2026-07-01", amountBase: 999, category: "Яблоки" }),
      tx({ date: "2026-07-01", amountBase: 500, category: "Бензин" }),
    ];
    expect(buildCategoryReport(t, "month", 1).expense.map((x) => x.label)).toEqual([
      "Автомобиль",
      "Бензин",
      "Яблоки",
    ]);
  });

  it("подкатегории тоже идут по алфавиту под своим родителем", () => {
    const t = [
      tx({ date: "2026-07-01", amountBase: 10, category: "Еда", subcategory: "Ресторан" }),
      tx({ date: "2026-07-01", amountBase: 900, category: "Еда", subcategory: "Кафе" }),
    ];
    const r = buildCategoryReport(t, "month", 1);
    expect(r.expense.map((x) => x.label)).toEqual(["Еда", "Кафе", "Ресторан"]);
  });

  it("«Без категории» остаётся последней, а не всплывает к «Б»", () => {
    const t = [
      tx({ date: "2026-07-01", amountBase: 10, category: "Без категории" }),
      tx({ date: "2026-07-01", amountBase: 10, category: "Автомобиль" }),
      tx({ date: "2026-07-01", amountBase: 10, category: "Яблоки" }),
    ];
    const r = buildCategoryReport(t, "month", 1);
    expect(r.expense.map((x) => x.label)).toEqual([
      "Автомобиль",
      "Яблоки",
      "Без категории",
    ]);
  });

  it("порядок не зависит от сумм — при их смене строки не переезжают", () => {
    const at = (a: number, b: number) =>
      buildCategoryReport(
        [
          tx({ date: "2026-07-01", amountBase: a, category: "Автомобиль" }),
          tx({ date: "2026-07-01", amountBase: b, category: "Яблоки" }),
        ],
        "month",
        1
      ).expense.map((x) => x.label);
    expect(at(1, 999)).toEqual(at(999, 1));
  });
});

describe("categoryReport — что может и чего не может пропасть из отчёта", () => {
  // Регрессия на жалобу «в отчёте не видно категорию Зарплата» (issue #37).
  // Сама пропажа была визуальной — шапка таблицы накрывала первую строку блока
  // «Доход». Эти тесты закрепляют, что на уровне ДАННЫХ доходную категорию
  // выкинуть нечем, и заодно перечисляют два случая, когда операция в отчёт
  // действительно не попадает.
  it("доходная категория попадает в отчёт при любой сумме", () => {
    for (const amountBase of [1, 0.5, 180000]) {
      const r = buildCategoryReport(
        [tx({ date: "2026-07-05", amountBase, category: "Зарплата", kind: "income" })],
        "month",
        1
      );
      expect(r.income.map((x) => x.label)).toContain("Зарплата");
    }
  });

  it("доход с нулевой суммой строку всё равно создаёт", () => {
    const r = buildCategoryReport(
      [tx({ date: "2026-07-05", amountBase: 0, category: "Зарплата", kind: "income" })],
      "month",
      1
    );
    expect(r.income.map((x) => x.label)).toContain("Зарплата");
  });

  it("доход остаётся в отчёте вместе с подкатегорией", () => {
    const r = buildCategoryReport(
      [
        tx({ date: "2026-07-05", amountBase: 100, category: "Зарплата", kind: "income" }),
        tx({
          date: "2026-07-06",
          amountBase: 50,
          category: "Зарплата",
          subcategory: "Премия",
          kind: "income",
        }),
      ],
      "month",
      1
    );
    expect(r.income.map((x) => x.label)).toEqual(["Зарплата", "Премия"]);
    // Сумма родителя включает подкатегорию.
    expect(r.income[0].total).toBe(150);
  });

  it("перевод между своими счетами в отчёт не попадает вовсе", () => {
    const r = buildCategoryReport(
      [tx({ date: "2026-07-05", amountBase: 180000, category: "Зарплата", kind: "transfer" })],
      "month",
      1
    );
    expect(r.income).toEqual([]);
    expect(r.expense).toEqual([]);
  });

  it("возврат уходит в расход отрицательной суммой, а не в доход", () => {
    const r = buildCategoryReport(
      [tx({ date: "2026-07-05", amountBase: 500, category: "Зарплата", kind: "refund" })],
      "month",
      1
    );
    expect(r.income).toEqual([]);
    expect(r.expense.map((x) => x.label)).toEqual(["Зарплата"]);
    expect(r.expense[0].total).toBe(-500);
  });
});
