import { describe, it, expect } from "vitest";
import {
  ALL_ACCOUNTS,
  budgetHit,
  budgetHits,
  insidePerimeter,
  transactionsForCell,
  type BudgetScope,
} from "./budgetScope";
import type { Transaction } from "../types";

let seq = 0;
function tx(p: Partial<Transaction>): Transaction {
  return {
    id: `t${++seq}`,
    date: "2026-06-10",
    amount: 0,
    amountBase: 1000,
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

function transfer(from: string, to: string, amountBase = 30_000): Transaction {
  return tx({
    kind: "transfer",
    category: "Переводы",
    account: from,
    outcomeAccount: from,
    incomeAccount: to,
    amountBase,
  });
}

const perimeter = (accounts: string[], perimeterTransfers = true): BudgetScope => ({
  accounts: new Set(accounts),
  perimeterTransfers,
});

describe("budgetHits: полный периметр", () => {
  it("берёт все счета", () => {
    expect(budgetHits(tx({ account: "Другой" }), ALL_ACCOUNTS)[0]).toMatchObject({
      kind: "expense",
      category: "Еда",
      amount: 1000,
    });
  });

  it("по умолчанию переводы не считаются", () => {
    expect(budgetHits(transfer("Карта", "Накопительный"), ALL_ACCOUNTS)).toEqual([]);
  });

  it("возврат уменьшает статью", () => {
    expect(budgetHits(tx({ kind: "refund" }), ALL_ACCOUNTS)[0].amount).toBe(-1000);
  });

  it("«Без категории» в бюджет не идёт", () => {
    expect(budgetHits(tx({ category: "Без категории" }), ALL_ACCOUNTS)).toEqual([]);
  });

  it("со включённой настройкой перевод виден ОБЕИМИ ногами", () => {
    // Списание — расход у счёта-источника, зачисление — доход у получателя.
    const scope = perimeter([]);
    expect(budgetHits(transfer("Карта", "Накопительный", 200), scope)).toEqual([
      {
        kind: "expense",
        category: "Переводы",
        subcategory: "Накопительный",
        amount: 200,
        transfer: true,
      },
      {
        kind: "income",
        category: "Переводы",
        subcategory: "Карта",
        amount: 200,
        transfer: true,
      },
    ]);
  });

  it("обе ноги равны — перевод не двигает разницу «доходы − расходы»", () => {
    const hits = budgetHits(transfer("Карта", "Накопительный", 200), perimeter([]));
    const expense = hits.filter((h) => h.kind === "expense").reduce((s, h) => s + h.amount, 0);
    const income = hits.filter((h) => h.kind === "income").reduce((s, h) => s + h.amount, 0);
    expect(income - expense).toBe(0);
  });
});

describe("budgetHits: суженный периметр", () => {
  const scope = perimeter(["Карта"]);

  it("операции внешних счетов не считаются", () => {
    expect(budgetHits(tx({ account: "Карта" }), scope)).toHaveLength(1);
    expect(budgetHits(tx({ account: "Наличные" }), scope)).toEqual([]);
  });

  it("перевод наружу — только расход: доход упал на чужой счёт", () => {
    expect(budgetHits(transfer("Карта", "Накопительный"), scope)).toEqual([
      {
        kind: "expense",
        category: "Переводы",
        subcategory: "Накопительный",
        amount: 30_000,
        transfer: true,
      },
    ]);
  });

  it("перевод внутрь — только доход", () => {
    expect(budgetHits(transfer("Накопительный", "Карта"), scope)).toEqual([
      {
        kind: "income",
        category: "Переводы",
        subcategory: "Накопительный",
        amount: 30_000,
        transfer: true,
      },
    ]);
  });

  it("перевод между двумя внутренними счетами даёт обе ноги", () => {
    const both = perimeter(["Карта", "Накопительный"]);
    expect(budgetHits(transfer("Карта", "Накопительный"), both).map((h) => h.kind)).toEqual([
      "expense",
      "income",
    ]);
  });

  it("перевод между двумя внешними счетами не считается", () => {
    expect(budgetHits(transfer("Наличные", "Накопительный"), scope)).toEqual([]);
  });

  it("с выключенной настройкой переводы не считаются вовсе", () => {
    const off = perimeter(["Карта"], false);
    expect(budgetHits(transfer("Карта", "Накопительный"), off)).toEqual([]);
    expect(budgetHits(tx({ account: "Карта" }), off)).toHaveLength(1);
  });
});

describe("budgetHit", () => {
  it("отдаёт первое попадание, а у перевода их два", () => {
    // Считать суммы через неё нельзя — вторая нога потеряется.
    const t = transfer("Карта", "Накопительный", 200);
    expect(budgetHit(t, perimeter([]))?.kind).toBe("expense");
    expect(budgetHits(t, perimeter([]))).toHaveLength(2);
  });
});

describe("transactionsForCell", () => {
  const scope = perimeter(["Карта"]);
  const txs = [
    tx({ date: "2026-06-01", account: "Карта" }),
    tx({ date: "2026-07-01", account: "Карта" }),
    tx({ date: "2026-06-02", account: "Наличные" }),
    transfer("Карта", "Накопительный"),
    transfer("Накопительный", "Карта"),
  ];

  it("возвращает операции статьи за месяц", () => {
    const got = transactionsForCell(txs, scope, { category: "Еда", subcategory: null }, "2026-06");
    expect(got.map((t) => t.account)).toEqual(["Карта"]);
  });

  it("различает направления одной статьи «Перевод»", () => {
    const out = transactionsForCell(txs, scope, {
      kind: "expense",
      category: "Переводы",
      subcategory: "Накопительный",
    });
    const inc = transactionsForCell(txs, scope, {
      kind: "income",
      category: "Переводы",
      subcategory: "Накопительный",
    });
    expect(out).toHaveLength(1);
    expect(out[0].outcomeAccount).toBe("Карта");
    expect(inc).toHaveLength(1);
    expect(inc[0].incomeAccount).toBe("Карта");
  });

  it("без указания направления берёт обе стороны", () => {
    const both = transactionsForCell(txs, scope, {
      category: "Переводы",
      subcategory: "Накопительный",
    });
    expect(both).toHaveLength(2);
  });
});

describe("insidePerimeter", () => {
  it("при полном периметре отдаёт список как есть", () => {
    const txs = [tx({}), transfer("Карта", "Накопительный")];
    expect(insidePerimeter(txs, ALL_ACCOUNTS)).toBe(txs);
  });

  it("оставляет только доходы и расходы своих счетов", () => {
    const txs = [
      tx({ account: "Карта" }),
      tx({ account: "Наличные" }),
      transfer("Карта", "Накопительный"),
    ];
    const got = insidePerimeter(txs, perimeter(["Карта"]));
    expect(got.map((t) => t.kind)).toEqual(["expense"]);
  });
});
