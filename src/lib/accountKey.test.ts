import { describe, it, expect } from "vitest";
import { fillAccountKeys } from "./accountKey";

const accounts = [
  { id: "a-cash", title: "Наличные", type: "cash" },
  { id: "a-t1", title: "Т-Банк", type: "ccard" },
  { id: "a-t2", title: "Т-Банк", type: "ccard" },
  { id: "a-d1", title: "Долги", type: "debt" },
  { id: "a-d2", title: "Долги", type: "debt" },
];

interface T {
  account: string;
  outcomeAccount: string;
  incomeAccount: string;
  accountId?: string;
  outcomeAccountId?: string;
  incomeAccountId?: string;
  accountKey?: string;
  outcomeAccountKey?: string;
  incomeAccountKey?: string;
}

const tx = (over: Partial<T> = {}): T => ({
  account: "Наличные",
  outcomeAccount: "Наличные",
  incomeAccount: "Наличные",
  ...over,
});

describe("fillAccountKeys — ключи операциям, сохранённым до их появления", () => {
  it("операция без ключа получает номер единственного счёта с этим названием", () => {
    const [t] = fillAccountKeys([tx()], accounts);
    expect(t.accountKey).toBe("a-cash");
    expect(t.outcomeAccountKey).toBe("a-cash");
    expect(t.incomeAccountKey).toBe("a-cash");
  });

  it("долги по валютам — ключ-название, как в справочнике", () => {
    const [t] = fillAccountKeys([tx({ account: "Долги", outcomeAccount: "Долги", incomeAccount: "Наличные" })], accounts);
    expect(t.accountKey).toBe("Долги");
    expect(t.incomeAccountKey).toBe("a-cash");
  });

  it("тёзки без номера: угадывать нечем — остаётся название", () => {
    const [t] = fillAccountKeys([tx({ account: "Т-Банк", outcomeAccount: "Т-Банк", incomeAccount: "Т-Банк" })], accounts);
    expect(t.accountKey).toBe("Т-Банк");
  });

  it("тёзки с номером — ключ по номеру", () => {
    const [t] = fillAccountKeys(
      [tx({ account: "Т-Банк", outcomeAccount: "Т-Банк", incomeAccount: "Т-Банк", accountId: "a-t2", outcomeAccountId: "a-t2", incomeAccountId: "a-t2" })],
      accounts
    );
    expect(t.accountKey).toBe("a-t2");
  });

  it("правка прежней версии сменила только название — номер устарел, ключ по новому названию", () => {
    const [t] = fillAccountKeys(
      [tx({ account: "Наличные", accountId: "a-t1", accountKey: "a-t1" })],
      accounts
    );
    expect(t.accountKey).toBe("a-cash");
  });

  it("верные ключи — тот же массив", () => {
    const list = [
      tx({ accountKey: "a-cash", outcomeAccountKey: "a-cash", incomeAccountKey: "a-cash", accountId: "a-cash" }),
    ];
    expect(fillAccountKeys(list, accounts)).toBe(list);
  });

  it("без справочника (CSV) — ничего не трогает", () => {
    const list = [tx()];
    expect(fillAccountKeys(list, null)).toBe(list);
  });
});
