import { describe, it, expect } from "vitest";
import type { Transaction } from "../types";
import {
  accountInflow,
  addFlows,
  benchmarkWindow,
  categoryFlow,
  DEFAULT_BENCHMARKS,
  doublingYears,
  flatShareBenchmark,
  growthBenchmark,
  isSubscription,
  parseBenchmarks,
  targetShareBenchmark,
  shareBenchmark,
} from "./benchmarks";

let n = 0;
const tx = (p: Partial<Transaction> & Pick<Transaction, "date" | "kind" | "amountBase">): Transaction =>
  ({
    id: `t${n++}`,
    category: "",
    subcategory: null,
    categoryFull: "",
    account: "",
    outcomeAccount: "",
    incomeAccount: "",
    currency: "RUB",
    amount: p.amountBase,
    ...p,
  }) as Transaction;

const income = (date: string, v: number) => tx({ date, kind: "income", amountBase: v, categoryFull: "Зарплата" });
const spend = (date: string, v: number, cat: string) => tx({ date, kind: "expense", amountBase: v, categoryFull: cat });
const move = (date: string, v: number, from: string, to: string) =>
  tx({ date, kind: "transfer", amountBase: v, outcomeAccountKey: from, incomeAccountKey: to });

describe("benchmarkWindow", () => {
  const txs = [income("2026-08-10", 100), income("2026-09-10", 100), income("2026-10-10", 100), income("2026-11-05", 100)];

  it("идущий месяц в расчёт не идёт", () => {
    const w = benchmarkWindow(txs, 1, "2026-11-15");
    expect(w.yms).toEqual(["2026-08", "2026-09", "2026-10"]);
  });

  it("завершённых месяцев нет — считаем по идущему", () => {
    const w = benchmarkWindow([income("2026-11-05", 100)], 1, "2026-11-15");
    expect(w.yms).toEqual(["2026-11"]);
  });

  it("не больше 12 месяцев, свой первый день месяца учитывается", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      income(`${2025 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-15`, 10)
    );
    expect(benchmarkWindow(many, 1, "2026-11-15").yms).toHaveLength(12);
    // День 10: операция 05.11 относится к октябрьскому отчётному месяцу.
    expect(benchmarkWindow(txs, 10, "2026-11-15").yms).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(benchmarkWindow(txs, 10, "2026-11-15").income.get("2026-10")).toBe(200);
  });
});

describe("доля в доходе", () => {
  const txs = [
    income("2026-09-10", 100_000),
    spend("2026-09-12", 30_000, "Жильё / Аренда"),
    spend("2026-09-13", 5_000, "Жильё / ЖКХ"),
    spend("2026-09-14", 9_000, "Еда"),
    income("2026-10-10", 100_000),
    spend("2026-10-12", 30_000, "Жильё / Аренда"),
    tx({ date: "2026-10-20", kind: "refund", amountBase: 2_000, categoryFull: "Жильё / Аренда" }),
  ];
  const w = benchmarkWindow(txs, 1, "2026-11-15");
  const cats = new Set(["Жильё / Аренда", "Жильё / ЖКХ"]);

  it("считает только отмеченные категории, возвраты вычитает", () => {
    const flow = categoryFlow(txs, cats, w, 1);
    expect(flow.get("2026-09")).toBe(35_000);
    expect(flow.get("2026-10")).toBe(28_000);
  });

  it("статус и месяцы выше порога", () => {
    const r = shareBenchmark(w, categoryFlow(txs, cats, w, 1), 33);
    expect(r.share).toBeCloseTo(0.315);
    expect(r.status).toBe("good");
    expect(r.monthsOver).toBe(1); // сентябрь — 35%
    expect(r.amount).toBe(31_500);
    expect(shareBenchmark(w, categoryFlow(txs, cats, w, 1), 30).status).toBe("warn");
    expect(shareBenchmark(w, categoryFlow(txs, cats, w, 1), 20).status).toBe("bad");
  });

  it("без дохода доли нет", () => {
    const only = [spend("2026-10-12", 30_000, "Жильё / Аренда")];
    const win = benchmarkWindow(only, 1, "2026-11-15");
    const r = shareBenchmark(win, categoryFlow(only, cats, win, 1), 33);
    expect(r.share).toBeNull();
    expect(r.status).toBe("na");
  });

  it("категории не выбраны — нули", () => {
    expect([...categoryFlow(txs, new Set(), w, 1).values()]).toEqual([0, 0]);
  });
});

describe("переводы на счета", () => {
  const txs = [
    income("2026-10-01", 100_000),
    move("2026-10-05", 20_000, "card", "loan"),
    move("2026-10-06", 50_000, "loan", "card"), // выдача кредита — не платёж
    move("2026-10-07", 10_000, "card", "broker"),
    move("2026-10-08", 4_000, "broker", "card"),
    move("2026-10-09", 3_000, "broker", "broker2"), // внутри набора
  ];
  const w = benchmarkWindow(txs, 1, "2026-11-15");

  it("платежи по кредиту — только переводы на счёт", () => {
    expect(accountInflow(txs, new Set(["loan"]), w, 1, false).get("2026-10")).toBe(20_000);
  });

  it("вложения — за вычетом изъятий, переводы внутри набора не считаются", () => {
    expect(accountInflow(txs, new Set(["broker", "broker2"]), w, 1, true).get("2026-10")).toBe(6_000);
  });

  it("ряды складываются", () => {
    const a = new Map([["2026-10", 5]]);
    expect(addFlows(a, new Map([["2026-10", 7]])).get("2026-10")).toBe(12);
  });
});

describe("доля вложений в доходе", () => {
  const w = { yms: ["2026-09", "2026-10"], income: new Map([["2026-09", 100_000], ["2026-10", 100_000]]) };
  const flow = (a: number, b: number) => new Map([["2026-09", a], ["2026-10", b]]);

  it("доля, цель и нехватка в месяц", () => {
    const r = targetShareBenchmark(w, flow(4_000, 8_000), 10);
    expect(r.share).toBeCloseTo(0.06);
    expect(r.status).toBe("warn");
    expect(r.amount).toBe(6_000);
    expect(r.gap).toBe(4_000);
    expect(targetShareBenchmark(w, flow(2_000, 2_000), 10).status).toBe("bad");
    const ok = targetShareBenchmark(w, flow(12_000, 10_000), 10);
    expect(ok.status).toBe("good");
    expect(ok.gap).toBe(0);
  });

  it("забрали больше, чем внесли, — доля отрицательная", () => {
    const r = targetShareBenchmark(w, flow(-5_000, 1_000), 10);
    expect(r.share).toBeCloseTo(-0.02);
    expect(r.status).toBe("bad");
  });

  it("без дохода доли нет", () => {
    expect(targetShareBenchmark({ yms: ["2026-10"], income: new Map() }, flow(0, 5_000), 10)).toMatchObject({
      share: null,
      status: "na",
    });
  });
});

describe("правило 72 и настройки", () => {
  it("срок удвоения", () => {
    expect(doublingYears(12)).toBe(6);
    expect(doublingYears(8)).toBe(9);
    expect(doublingYears(0)).toBeNull();
  });

  it("битое и чужое заменяется значениями по умолчанию", () => {
    expect(parseBenchmarks(null)).toEqual(DEFAULT_BENCHMARKS);
    const p = parseBenchmarks({ housingLimit: 500, housingCategories: ["Жильё", 5], debtAccounts: ["a"], investRate: "12" });
    expect(p.housingLimit).toBe(80);
    expect(p.housingCategories).toEqual([]);
    expect(p.debtAccounts).toEqual(["a"]);
    expect(p.investRate).toBe(12);
    expect(parseBenchmarks({ debtAccounts: null }).debtAccounts).toBeNull();
  });
});

describe("рост расходов к доходам", () => {
  /** `n` месяцев назад от октября 2026 с доходом и расходом. */
  const months = (list: [number, number][]) =>
    list.flatMap(([inc, exp], i) => {
      const d = new Date(2026, 9 - (list.length - 1 - i), 10);
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-10`;
      return [income(date, inc), spend(date, exp, "Еда")];
    });

  it("расходы растут быстрее доходов", () => {
    const txs = months([...Array(12).fill([100, 50]), ...Array(12).fill([110, 60])]);
    const r = growthBenchmark(txs, 1, "2026-11-15");
    expect(r.months).toBe(12);
    expect(r.incomeGrowth).toBeCloseTo(0.1);
    expect(r.expenseGrowth).toBeCloseTo(0.2);
    expect(r.gap).toBeCloseTo(0.1);
    expect(r.status).toBe("bad");
  });

  it("чуть быстрее — предупреждение, не быстрее — норма", () => {
    const warn = months([...Array(6).fill([100, 50]), ...Array(6).fill([110, 57])]);
    expect(growthBenchmark(warn, 1, "2026-11-15")).toMatchObject({ months: 6, status: "warn" });
    const good = months([...Array(6).fill([100, 50]), ...Array(6).fill([120, 55])]);
    expect(growthBenchmark(good, 1, "2026-11-15").status).toBe("good");
  });

  it("истории меньше полугода — сравнивать не с чем; идущий месяц не считается", () => {
    const r = growthBenchmark(months(Array(5).fill([100, 50])), 1, "2026-11-15");
    expect(r).toMatchObject({ months: 2, status: "na" });
    // Те же шесть месяцев, но «сегодня» — октябрь: завершённых пять.
    expect(growthBenchmark(months(Array(6).fill([100, 50])), 1, "2026-10-20").months).toBe(2);
  });
});

describe("доля готовой месячной суммы", () => {
  const w = { yms: ["2026-09", "2026-10"], income: new Map([["2026-09", 100_000], ["2026-10", 140_000]]) };

  it("делит на средний доход окна", () => {
    const r = flatShareBenchmark(w, 12_000, 15);
    expect(r.share).toBeCloseTo(0.1);
    expect(r.status).toBe("good");
    expect(flatShareBenchmark(w, 20_000, 15).status).toBe("warn");
    expect(flatShareBenchmark(w, 30_000, 15).status).toBe("bad");
  });

  it("подписка — раз в месяц или реже, ровной суммой и действующая", () => {
    const c = { cadence: "monthly", consistency: 0.9, stale: false };
    expect(isSubscription(c)).toBe(true);
    expect(isSubscription({ ...c, cadence: "quarterly" })).toBe(true);
    expect(isSubscription({ ...c, cadence: "weekly" })).toBe(false);
    expect(isSubscription({ ...c, consistency: 0.5 })).toBe(false);
    expect(isSubscription({ ...c, stale: true })).toBe(false);
  });

  it("без дохода доли нет", () => {
    expect(flatShareBenchmark({ yms: [], income: new Map() }, 5_000, 15)).toMatchObject({ share: null, status: "na" });
  });
});
