import { describe, it, expect } from "vitest";
import {
  balanceKey,
  stackedBalanceByAccount,
  transactionLegs,
  type BalanceValuation,
  type StackedBalancePoint,
} from "./aggregations";
import { makeRateAt } from "./historicalRates";
import { debtKey } from "./debtFilter";
import { tx } from "../test/fixtures";

/**
 * Остатки по правилам Дзен-мани (сверено на живом аккаунте 29.09.2026):
 * остаток на дату = начальный остаток + операции до неё, в валюте счёта, по
 * курсу того дня; начальный остаток действует с начала истории.
 */

const RUB_ONLY = () => 1;

function valuation(
  balances: Record<string, number>,
  over: Partial<BalanceValuation> = {}
): BalanceValuation {
  const b: Record<string, number> = {};
  for (const [k, v] of Object.entries(balances)) {
    b[k.includes("|") ? balanceKey(k.split("|")[0], k.split("|")[1]) : balanceKey(k, "RUB")] = v;
  }
  return { balances: b, rateAt: RUB_ONLY, universe: null, ...over };
}

const at = (series: StackedBalancePoint[], date: string) =>
  series.find((p) => p.date === date)!;

describe("остатки по правилам Дзен-мани", () => {
  it("начальный остаток действует с начала истории, а не с первой операции счёта", () => {
    // «ИИС»: на 01.01.2023 в Дзен-мани уже 1 200 000, хотя первая операция — в марте.
    const txs = [
      tx({ kind: "expense", amount: 500, outcomeAccount: "Карта", date: "2023-01-02" }),
      tx({ kind: "expense", amount: 1000, outcomeAccount: "ИИС", date: "2023-03-07" }),
    ];
    const { series } = stackedBalanceByAccount(
      txs, 9, null, null, null, null,
      valuation({ Карта: 4500, ИИС: 1_199_000 })
    );
    expect(at(series, "2023-01-02")["ИИС"]).toBe(1_200_000);
    expect(at(series, "2023-01-02").total).toBe(1_200_000 + 4500);
    expect(at(series, "2023-03-07")["ИИС"]).toBe(1_199_000);
  });

  it("вклад с суммой договора, но без денег, не уводит историю в минус", () => {
    // «Озон — Нак.счёт»: в API startBalance = 100 000 (сумма вклада), остаток 0,
    // операций нет. Прежде эти 100 000 вычитались из всей ранней истории.
    const txs = [
      tx({ kind: "income", amount: 1000, incomeAccount: "Карта", date: "2023-01-10" }),
      tx({ kind: "income", amount: 1000, incomeAccount: "Карта", date: "2023-10-10" }),
    ];
    const { series } = stackedBalanceByAccount(
      txs, 9, null, null, null, null,
      valuation({ Карта: 2000, Вклад: 0 })
    );
    expect(series.map((p) => p.total)).toEqual([1000, 2000]);
  });

  it("перевод между валютами: каждая сторона — своей суммой в своей валюте", () => {
    // Купили 100 $ за 9 000 ₽. На долларовый счёт пришли доллары, а не рубли по ЦБ.
    const txs = [
      tx({
        kind: "transfer",
        amount: 9000,
        currency: "RUB",
        outcomeAccount: "Рубли",
        incomeAccount: "Доллары",
        incomeAmount: 100,
        incomeCurrency: "USD",
        date: "2024-01-10",
      }),
    ];
    const rateAt = (c: string) => (c === "USD" ? 88 : 1);
    const { series } = stackedBalanceByAccount(
      txs, 9, null, null, null, null,
      valuation({ Рубли: 1000, "Доллары|USD": 100 }, { rateAt })
    );
    const p = at(series, "2024-01-10");
    expect(p["Доллары"]).toBe(8800); // 100 $ по курсу дня, а не 9 000 ₽ списания
    expect(p["Рубли"]).toBe(1000);
  });

  it("валютный счёт в прошлом — валюта на тот день по курсу того дня", () => {
    const txs = [
      tx({ kind: "income", amount: 10, currency: "USD", incomeAccount: "Доллары", date: "2023-01-01" }),
      tx({ kind: "income", amount: 10, currency: "USD", incomeAccount: "Доллары", date: "2024-01-01" }),
    ];
    // Последняя точка — по курсу синхронизации (самая поздняя дата), прошлые — по курсу дня.
    const rateAt = (c: string, d: string) => (c !== "USD" ? 1 : d < "2024-01-01" ? 70 : 90);
    const { series } = stackedBalanceByAccount(
      txs, 9, null, null, null, null,
      valuation({ "Доллары|USD": 20 }, { rateAt })
    );
    expect(at(series, "2023-01-01")["Доллары"]).toBe(700); // 10 $ × 70
    expect(at(series, "2024-01-01")["Доллары"]).toBe(1800); // 20 $ × 90
  });

  it("последняя точка — по курсу синхронизации, даже если операция была раньше", () => {
    const txs = [
      tx({ kind: "income", amount: 10, currency: "USD", incomeAccount: "Доллары", date: "2026-09-01" }),
    ];
    const rateAt = (c: string, d: string) => (c !== "USD" ? 1 : d >= "2026-09-29" ? 95 : 80);
    const { series } = stackedBalanceByAccount(
      txs, 9, null, null, null, null,
      valuation({ "Доллары|USD": 10 }, { rateAt })
    );
    expect(series.at(-1)!.total).toBe(950);
  });

  it("одноимённые счета в разных валютах («Долги») не складываются без пересчёта", () => {
    const txs = [
      tx({ kind: "transfer", amount: 100, currency: "RUB", outcomeAccount: "Карта", incomeAccount: "Долги", date: "2024-02-01" }),
      tx({ kind: "transfer", amount: 10, currency: "USD", outcomeAccount: "Кошелёк", incomeAccount: "Долги", incomeCurrency: "USD", date: "2024-02-01" }),
    ];
    const rateAt = (c: string) => (c === "USD" ? 90 : 1);
    const { series } = stackedBalanceByAccount(
      txs, 9, null, null, ["Долги"], null,
      valuation({ Долги: 100, "Долги|USD": 10 }, { rateAt })
    );
    expect(at(series, "2024-02-01")["Долги"]).toBe(100 + 900);
  });

  it("без ручного выбора — только счета «в балансе», и «Итого» с ними сходится", () => {
    const txs = [
      tx({ kind: "income", amount: 1000, incomeAccount: "Карта", date: "2024-01-01" }),
      tx({ kind: "transfer", amount: 300, outcomeAccount: "Карта", incomeAccount: "Брокер", date: "2024-01-02" }),
    ];
    const v = valuation({ Карта: 700, Брокер: 300 }, { universe: new Set(["Карта"]) });
    const { accounts, series } = stackedBalanceByAccount(txs, 9, null, null, null, null, v);
    expect(accounts).toEqual(["Карта"]);
    // Перевод на счёт вне баланса — это уход денег из баланса.
    expect(series.map((p) => p.total)).toEqual([1000, 700]);
  });

  it("архивный счёт с прошлыми деньгами остаётся в истории", () => {
    const txs = [
      tx({ kind: "income", amount: 500_000, incomeAccount: "Закрытый", date: "2022-01-01" }),
      tx({ kind: "transfer", amount: 500_000, outcomeAccount: "Закрытый", incomeAccount: "Карта", date: "2024-01-01" }),
    ];
    const { series } = stackedBalanceByAccount(
      txs, 9, null, null, null, null,
      valuation({ Закрытый: 0, Карта: 500_000 })
    );
    expect(at(series, "2022-01-01").total).toBe(500_000);
    expect(at(series, "2024-01-01").total).toBe(500_000);
  });

  it("конец совпадает с остатками, неотправленный черновик — сверху", () => {
    const txs = [
      tx({ kind: "income", amount: 1000, incomeAccount: "Карта", date: "2024-01-01" }),
      tx({ id: "draft", kind: "expense", amount: 200, outcomeAccount: "Карта", date: "2024-01-02" }),
    ];
    const v = valuation({ Карта: 5000 });
    const synced = stackedBalanceByAccount(txs.slice(0, 1), 9, null, null, null, null, v);
    expect(synced.series.at(-1)!.total).toBe(5000);
    // Остаток в API о черновике не знает: линия кончается на остатке минус черновик.
    const withDraft = stackedBalanceByAccount(txs, 9, null, new Set(["draft"]), null, null, v);
    expect(withDraft.series.map((p) => p.total)).toEqual([5000, 4800]);
  });

  it("операции «1970 года» входят в остаток, но точки на оси не дают", () => {
    const txs = [
      tx({ kind: "income", amount: 300, incomeAccount: "Карта", date: "1970-01-01" }),
      tx({ kind: "income", amount: 100, incomeAccount: "Карта", date: "2024-01-01" }),
    ];
    const { series } = stackedBalanceByAccount(
      txs, 9, null, null, null, null,
      valuation({ Карта: 400 })
    );
    expect(series.map((p) => p.date)).toEqual(["2024-01-01"]);
    expect(series[0].total).toBe(400);
  });

  it("контрагент долгового счёта своим слоем — «Итого» не меняется", () => {
    const txs = [
      tx({ kind: "transfer", amount: 1000, outcomeAccount: "Карта", incomeAccount: "Долги", payee: "Иван", date: "2024-01-01" }),
      tx({ kind: "transfer", amount: 500, outcomeAccount: "Карта", incomeAccount: "Долги", payee: "Пётр", date: "2024-01-02" }),
    ];
    const v = valuation({ Долги: 1500, Карта: 0 });
    const plain = stackedBalanceByAccount(txs, 9, null, null, ["Долги"], null, v);
    const split = stackedBalanceByAccount(
      txs, 9, null, null, ["Долги", debtKey("Долги", "Иван")], new Map([["Долги", new Set(["Иван"])]]), v
    );
    const last = split.series.at(-1)!;
    expect(last.total).toBe(plain.series.at(-1)!.total);
    expect(last[debtKey("Долги", "Иван")]).toBe(1000); // Иван — ровно его долг
    expect(last["Долги"]).toBe(500); // на счёте — остальное
  });
});

describe("transactionLegs", () => {
  it("правка суммы перевода меняет обе стороны в той же пропорции", () => {
    const t = tx({
      kind: "transfer", amount: 4500, outcomeAmount: 9000, outcomeAccount: "Рубли",
      incomeAccount: "Доллары", incomeAmount: 100, incomeCurrency: "USD",
    });
    expect(transactionLegs(t)).toEqual([
      { account: "Рубли", currency: "RUB", amount: -4500 },
      { account: "Доллары", currency: "USD", amount: 50 },
    ]);
  });

  it("возврат — приход на счёт, как доход", () => {
    const t = tx({ kind: "refund", amount: 70, incomeAccount: "Карта" });
    expect(transactionLegs(t)).toEqual([{ account: "Карта", currency: "RUB", amount: 70 }]);
  });
});

describe("makeRateAt", () => {
  const rates = { base: "RUB", rates: { RUB: 1, USD: 95 } };
  const hist = {
    "2024-01-09": { USD: 89.7 },
    "2024-03-01": { USD: 91.5 },
    "2024-02-10": {},
  };
  const rateAt = makeRateAt(rates, hist, "2026-09-29");

  it("курс ближайшего известного дня не позже даты", () => {
    expect(rateAt("USD", "2024-01-09")).toBe(89.7);
    expect(rateAt("USD", "2024-02-20")).toBe(89.7);
    expect(rateAt("USD", "2024-03-05")).toBe(91.5);
  });

  it("до первой котировки и с сегодняшнего дня — курс синхронизации", () => {
    expect(rateAt("USD", "2023-12-31")).toBe(95);
    expect(rateAt("USD", "2026-09-29")).toBe(95);
  });

  it("рубль — единица, база не рубль — курс синхронизации", () => {
    expect(rateAt("RUB", "2024-01-09")).toBe(1);
    const usdBase = makeRateAt({ base: "USD", rates: { USD: 1, RUB: 0.011 } }, hist, "2026-09-29");
    expect(usdBase("RUB", "2024-01-09")).toBeCloseTo(0.011);
    expect(usdBase("USD", "2024-01-09")).toBe(1);
  });
});
