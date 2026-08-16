import { describe, it, expect } from "vitest";
import {
  counterpartyOf,
  debtKey,
  debtSelection,
  matchesDebtSelection,
  parseDebtKey,
} from "./debtFilter";
import type { Transaction } from "../types";

const tx = (over: Partial<Transaction> = {}): Transaction =>
  ({
    id: "t1",
    date: "2026-08-16",
    amount: -1000,
    amountBase: -1000,
    currency: "RUB",
    kind: "transfer",
    account: "Сбер",
    outcomeAccount: "Сбер",
    incomeAccount: "Долги",
    payee: "Иван",
    category: "Долг",
    categoryFull: "Долг",
    ...over,
  }) as Transaction;

describe("ключ «счёт → контрагент»", () => {
  it("собирается и разбирается обратно", () => {
    const key = debtKey("Долги", "Иван Петров");
    expect(parseDebtKey(key)).toEqual({ account: "Долги", payee: "Иван Петров" });
  });

  it("обычный счёт ключом не считается", () => {
    expect(parseDebtKey("Долги")).toBeNull();
    expect(parseDebtKey("Т-Банк - Нак.счет")).toBeNull();
  });

  it("имя с пробелами и дефисами не ломает разбор", () => {
    const key = debtKey("Долги - валютные", "ООО «Ромашка»");
    expect(parseDebtKey(key)).toEqual({
      account: "Долги - валютные",
      payee: "ООО «Ромашка»",
    });
  });
});

describe("отбор по контрагенту долгового счёта", () => {
  const picks = debtSelection([debtKey("Долги", "Иван"), "Сбер"]);

  it("обычные счета в разбор не попадают", () => {
    expect(picks.size).toBe(1);
    expect([...picks.get("Долги")!]).toEqual(["Иван"]);
  });

  it("операция с этим контрагентом попадает — счёт в приходной ноге", () => {
    expect(matchesDebtSelection(tx(), picks)).toBe(true);
  });

  it("и в расходной тоже: вернули долг", () => {
    const back = tx({ outcomeAccount: "Долги", incomeAccount: "Сбер", account: "Долги" });
    expect(matchesDebtSelection(back, picks)).toBe(true);
  });

  it("другой контрагент того же счёта не попадает", () => {
    expect(matchesDebtSelection(tx({ payee: "Мария" }), picks)).toBe(false);
  });

  it("операция без контрагента ловится отдельным вариантом", () => {
    const none = debtSelection([debtKey("Долги", "Без контрагента")]);
    expect(matchesDebtSelection(tx({ payee: "" }), none)).toBe(true);
    expect(matchesDebtSelection(tx({ payee: "" }), picks)).toBe(false);
  });

  it("пустой отбор не ловит ничего", () => {
    expect(matchesDebtSelection(tx(), debtSelection([]))).toBe(false);
  });

  it("контрагент считается так же, как в разбивке долгов", () => {
    expect(counterpartyOf(tx({ payee: "  Иван  " }))).toBe("Иван");
    expect(counterpartyOf(tx({ payee: "" }))).toBe("Без контрагента");
  });
});
