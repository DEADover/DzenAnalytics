import { describe, it, expect } from "vitest";
import { buildAccountDirectory, type DirAccount } from "./accountDirectory";

const acc = (p: Partial<DirAccount> & Pick<DirAccount, "id" | "title">): DirAccount => ({
  type: "ccard",
  currency: "RUB",
  bank: null,
  archive: false,
  inBalance: true,
  savings: false,
  ...p,
});

describe("buildAccountDirectory", () => {
  it("тёзки — разными строками с уточнением по банку", () => {
    const d = buildAccountDirectory([
      acc({ id: "a", title: "Т-Банк", bank: "Т-Банк" }),
      acc({ id: "b", title: "Т-Банк", bank: "Альфа-Банк" }),
      acc({ id: "c", title: "Сбер" }),
    ]);
    expect(d.list).toHaveLength(3);
    expect(d.label("a")).toBe("Т-Банк · Т-Банк");
    expect(d.label("b")).toBe("Т-Банк · Альфа-Банк");
    expect(d.label("c")).toBe("Сбер");
    expect(d.keysByTitle("Т-Банк").sort()).toEqual(["a", "b"]);
  });

  it("банк не различает — по валюте", () => {
    const d = buildAccountDirectory([
      acc({ id: "a", title: "Наличные", type: "cash" }),
      acc({ id: "b", title: "Наличные", type: "cash", currency: "USD" }),
    ]);
    expect(d.label("a")).toBe("Наличные · RUB");
    expect(d.label("b")).toBe("Наличные · USD");
  });

  it("совсем одинаковые — по номеру", () => {
    const d = buildAccountDirectory([acc({ id: "a", title: "Карта" }), acc({ id: "b", title: "Карта" })]);
    expect([d.label("a"), d.label("b")]).toEqual(["Карта · 1", "Карта · 2"]);
  });

  it("долги по валютам — один счёт", () => {
    const d = buildAccountDirectory([
      acc({ id: "d1", title: "Долги", type: "debt" }),
      acc({ id: "d2", title: "Долги", type: "debt", currency: "USD" }),
    ]);
    expect(d.list).toHaveLength(1);
    expect(d.byKey.get("Долги")?.ids).toEqual(["d1", "d2"]);
    expect(d.label("Долги")).toBe("Долги");
  });

  it("счёт только из операций (CSV) — по названию", () => {
    const d = buildAccountDirectory(null, [
      { account: "Карта", outcomeAccount: "Карта", incomeAccount: "Карта" },
    ]);
    expect(d.list.map((e) => e.key)).toEqual(["Карта"]);
    expect(d.byKey.get("Карта")?.live).toBe(false);
  });
});
