import { describe, it, expect } from "vitest";
import { debtsByCounterparty, NO_COUNTERPARTY } from "./debts";
import type { Transaction } from "../types";

const DEBT = new Set(["Долги"]);

let seq = 0;
/** Долговая операция: перевод между реальным счётом и счётом «Долги». */
function debt(p: {
  date?: string;
  amount: number;
  payee?: string;
  /** «lend» — деньги ушли на долговой счёт, «back» — со счёта. */
  dir: "lend" | "back";
}): Transaction {
  const real = "Карта";
  return {
    id: `d${++seq}`,
    date: p.date ?? "2026-05-01",
    amount: p.amount,
    amountBase: p.amount,
    currency: "RUB",
    kind: "transfer",
    category: "Долг",
    subcategory: null,
    payee: p.payee ?? "",
    comment: "",
    account: real,
    outcomeAccount: p.dir === "lend" ? real : "Долги",
    incomeAccount: p.dir === "lend" ? "Долги" : real,
  } as Transaction;
}

describe("debtsByCounterparty", () => {
  it("дал в долг — контрагент должен вам", () => {
    const r = debtsByCounterparty([debt({ amount: 5000, payee: "Ренат", dir: "lend" })], DEBT);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ payee: "Ренат", amount: 5000, out: 5000, back: 0, count: 1 });
    expect(r.owedToYou).toBe(5000);
    expect(r.owedByYou).toBe(0);
  });

  it("взял в долг — должны вы, сумма отрицательная", () => {
    const r = debtsByCounterparty([debt({ amount: 3000, payee: "Мама", dir: "back" })], DEBT);
    expect(r.rows[0].amount).toBe(-3000);
    expect(r.owedByYou).toBe(3000);
    expect(r.owedToYou).toBe(0);
  });

  it("частичный возврат уменьшает долг", () => {
    const r = debtsByCounterparty(
      [
        debt({ date: "2026-01-10", amount: 10_000, payee: "Ренат", dir: "lend" }),
        debt({ date: "2026-03-05", amount: 4000, payee: "Ренат", dir: "back" }),
      ],
      DEBT
    );
    expect(r.rows[0]).toMatchObject({ amount: 6000, out: 10_000, back: 4000, count: 2 });
    expect(r.rows[0].last).toBe("2026-03-05");
    expect(r.rows[0].settled).toBe(false);
  });

  it("рассчитались — итог ноль, и такие уходят в конец списка", () => {
    const r = debtsByCounterparty(
      [
        debt({ amount: 1000, payee: "Костя", dir: "lend" }),
        debt({ amount: 1000, payee: "Костя", dir: "back" }),
        debt({ amount: 500, payee: "Ренат", dir: "lend" }),
      ],
      DEBT
    );
    expect(r.rows.map((x) => x.payee)).toEqual(["Ренат", "Костя"]);
    expect(r.rows[1].settled).toBe(true);
    expect(r.rows[1].amount).toBe(0);
  });

  it("итог по всем контрагентам — это остаток долгового счёта", () => {
    const r = debtsByCounterparty(
      [
        debt({ amount: 5000, payee: "Ренат", dir: "lend" }),
        debt({ amount: 3000, payee: "Мама", dir: "back" }),
      ],
      DEBT
    );
    expect(r.total).toBe(2000);
    expect(r.owedToYou - r.owedByYou).toBe(r.total);
  });

  it("операции без контрагента собираются отдельной строкой, а не теряются", () => {
    const r = debtsByCounterparty([debt({ amount: 700, dir: "lend" })], DEBT);
    expect(r.rows[0].payee).toBe(NO_COUNTERPARTY);
    expect(r.rows[0].amount).toBe(700);
  });

  it("обычные переводы и траты не считаются", () => {
    const plain = {
      ...debt({ amount: 100, payee: "Ренат", dir: "lend" }),
      outcomeAccount: "Карта",
      incomeAccount: "Наличные",
    } as Transaction;
    expect(debtsByCounterparty([plain], DEBT).rows).toHaveLength(0);
  });

  it("перевод внутри долговых счетов ничего не меняет", () => {
    const inner = {
      ...debt({ amount: 100, payee: "Ренат", dir: "lend" }),
      outcomeAccount: "Долги",
      incomeAccount: "Долги",
    } as Transaction;
    expect(debtsByCounterparty([inner], new Set(["Долги"])).rows).toHaveLength(0);
  });

  it("хвосты пересчёта по курсу не мешают считать долг закрытым", () => {
    const r = debtsByCounterparty(
      [
        { ...debt({ amount: 1000, payee: "Ренат", dir: "lend" }), amountBase: 1000.002 },
        debt({ amount: 1000, payee: "Ренат", dir: "back" }),
      ],
      DEBT
    );
    expect(r.rows[0].settled).toBe(true);
  });
});
