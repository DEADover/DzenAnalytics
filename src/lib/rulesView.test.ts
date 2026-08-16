import { describe, it, expect } from "vitest";
import { rulesView } from "./rulesView";
import type { Transaction } from "../types";

const tx = (over: Partial<Transaction> = {}): Transaction =>
  ({
    id: "t1",
    date: "2026-08-16",
    amount: -100,
    amountBase: -100,
    currency: "RUB",
    kind: "expense",
    account: "Сбер",
    payee: "БАНК",
    comment: "Прочие поступления",
    category: "Другое",
    subcategory: null,
    categoryFull: "Другое",
    ...over,
  }) as Transaction;

describe("rulesView — операции глазами правил", () => {
  it("ручная правка комментария видна правилу", () => {
    const [row] = rulesView([tx()], { t1: { comment: "Дивиденды" } });
    expect(row.comment).toBe("Дивиденды");
  });

  it("исходник не портится — правится копия", () => {
    const src = tx();
    rulesView([src], { t1: { comment: "Дивиденды" } });
    expect(src.comment).toBe("Прочие поступления");
  });

  it("суммы и даты остаются исходными: сопоставлять по ним нечего", () => {
    const [row] = rulesView([tx()], { t1: { comment: "х", amount: -999 } as never });
    expect(row.amount).toBe(-100);
  });

  it("операция без правок возвращается той же самой", () => {
    const src = tx();
    const [row] = rulesView([src], { другая: { comment: "х" } });
    expect(row).toBe(src);
  });

  it("без правок список возвращается как есть", () => {
    const src = [tx()];
    expect(rulesView(src, {})).toBe(src);
  });

  it("правятся все поля, по которым правило умеет искать", () => {
    const [row] = rulesView([tx()], {
      t1: { brand: "Т-Банк", categoryFull: "Доход / Дивиденды", account: "Наличные" },
    });
    expect([row.brand, row.categoryFull, row.account]).toEqual([
      "Т-Банк",
      "Доход / Дивиденды",
      "Наличные",
    ]);
  });
});
