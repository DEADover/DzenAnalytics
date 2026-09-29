import { describe, it, expect } from "vitest";
import { rankPayees } from "./payeeSuggest";
import { tx } from "../test/fixtures";

const today = "2026-09-30";

describe("rankPayees", () => {
  it("частые и свежие — выше редких и старых", () => {
    const txs = [
      tx({ payee: "Пятёрочка", date: "2026-09-20" }),
      tx({ payee: "Пятёрочка", date: "2026-09-10" }),
      tx({ payee: "Старый магазин", date: "2024-01-10" }),
      tx({ payee: "Старый магазин", date: "2024-02-10" }),
      tx({ payee: "Старый магазин", date: "2024-03-10" }),
      tx({ payee: "Кофейня", date: "2026-09-25" }),
    ];
    expect(rankPayees(txs, { today })).toEqual(["Пятёрочка", "Кофейня", "Старый магазин"]);
  });

  it("выбранная категория поднимает своих получателей", () => {
    const txs = [
      tx({ payee: "АЗС", category: "Транспорт", date: "2026-09-20" }),
      tx({ payee: "АЗС", category: "Транспорт", date: "2026-09-21" }),
      tx({ payee: "Кофейня", category: "Кафе", date: "2026-09-22" }),
    ];
    expect(rankPayees(txs, { today, category: "Кафе" })[0]).toBe("Кофейня");
  });

  it("получатель из справочника важнее строки выписки, переводы не в счёт", () => {
    const txs = [
      tx({ payee: "YOLOCHKA 7712", brand: "Ёлочка", date: "2026-09-20" }),
      tx({ kind: "transfer", payee: "Себе", date: "2026-09-20" }),
    ];
    expect(rankPayees(txs, { today })).toEqual(["Ёлочка"]);
  });
});
