import { describe, expect, it } from "vitest";
import { capitalAccountKeys, planFactRow } from "./monthReview";
import { debtKey } from "./debtFilter";
import { MEMBER_SHARED } from "./zenUsers";

const accounts = [
  { key: "card", member: 1 },
  { key: "cash", member: 2 },
  { key: "family", member: null },
  { key: "broker", member: 1 },
  { key: "debts", member: 1 },
];
const universe = new Set(["card", "cash", "family", "debts"]);
const none = new Set<string>();

describe("capitalAccountKeys", () => {
  it("без фильтров — обычный набор «в балансе»", () => {
    expect(capitalAccountKeys({ accounts, universe, pickedAccounts: none, pickedUsers: none })).toBeNull();
  });

  it("отмеченные счета идут как есть, даже вне баланса", () => {
    expect(
      capitalAccountKeys({ accounts, universe, pickedAccounts: new Set(["card", "broker"]), pickedUsers: none })
    ).toEqual(["card", "broker"]);
  });

  it("«Чьи операции» оставляет счета участника из тех, что в балансе", () => {
    expect(capitalAccountKeys({ accounts, universe, pickedAccounts: none, pickedUsers: new Set(["1"]) })).toEqual([
      "card",
      "debts",
    ]);
    expect(
      capitalAccountKeys({ accounts, universe, pickedAccounts: none, pickedUsers: new Set([MEMBER_SHARED]) })
    ).toEqual(["family"]);
  });

  it("оба фильтра сужают вместе", () => {
    expect(
      capitalAccountKeys({
        accounts,
        universe,
        pickedAccounts: new Set(["card", "cash"]),
        pickedUsers: new Set(["2"]),
      })
    ).toEqual(["cash"]);
  });

  it("долг по человеку — весь долговой счёт", () => {
    expect(
      capitalAccountKeys({
        accounts,
        universe,
        pickedAccounts: new Set([debtKey("debts", "Иван")]),
        pickedUsers: none,
      })
    ).toEqual(["debts"]);
  });

  it("«снять все» — счетов нет", () => {
    expect(
      capitalAccountKeys({ accounts, universe, pickedAccounts: new Set(["\u0000__none__"]), pickedUsers: none })
    ).toEqual([]);
  });
});

describe("planFactRow", () => {
  it("считает долю и остаток", () => {
    expect(planFactRow(100_000, 64_000)).toEqual({ plan: 100_000, fact: 64_000, ratio: 0.64, left: 36_000 });
  });
  it("перерасход — остаток отрицательный", () => {
    expect(planFactRow(50_000, 60_000)?.left).toBe(-10_000);
  });
  it("без плана строки нет", () => {
    expect(planFactRow(0, 5_000)).toBeNull();
  });
});
