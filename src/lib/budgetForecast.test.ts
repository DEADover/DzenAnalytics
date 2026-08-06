import { describe, it, expect } from "vitest";
import {
  buildForecast,
  forecastChanges,
  previousPlan,
  tagKey,
} from "./budgetForecast";
import type { BudgetLine } from "./budgets";
import type { Transaction } from "../types";

let seq = 0;
function tx(p: Partial<Transaction>): Transaction {
  return {
    id: `t${++seq}`,
    date: "2026-01-15",
    amount: 0,
    amountBase: 0,
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

function line(p: Partial<BudgetLine>): BudgetLine {
  return {
    id: `l${++seq}`,
    category: "Еда",
    subcategory: null,
    kind: "expense",
    amount: 0,
    recurrence: "monthly",
    startMonth: "2025-01",
    endMonth: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    ...p,
  };
}

const opts = { months: 3, basis: "average" as const };

describe("buildForecast: окно расчёта", () => {
  it("берёт месяцы ПЕРЕД целевым и не берёт сам целевой", () => {
    const txs = [
      tx({ date: "2026-03-10", amountBase: 1000 }),
      tx({ date: "2026-04-10", amountBase: 1000 }),
      tx({ date: "2026-05-10", amountBase: 1000 }),
      // Целевой месяц ещё не кончился — если его учесть, среднее просядет.
      tx({ date: "2026-06-01", amountBase: 100 }),
    ];
    const [r] = buildForecast(txs, [], "2026-06", opts);
    expect(r.history).toEqual([1000, 1000, 1000]);
    expect(r.suggested).toBe(1000);
  });

  it("отбрасывает ведущие пустые месяцы — новая категория не делится на год", () => {
    // Категория появилась за месяц до целевого: среднее за 12 месяцев дало бы
    // 1/12 от реальных трат.
    const txs = [tx({ date: "2026-05-10", amountBase: 12_000 })];
    const [r] = buildForecast(txs, [], "2026-06", { months: 12, basis: "average" });
    expect(r.monthsUsed).toBe(1);
    expect(r.suggested).toBe(12_000);
  });

  it("пустые месяцы ВНУТРИ окна учитывает — редкая трата размазывается", () => {
    const txs = [
      tx({ date: "2026-03-10", amountBase: 3000 }),
      tx({ date: "2026-05-10", amountBase: 3000 }),
    ];
    const [r] = buildForecast(txs, [], "2026-06", opts);
    expect(r.history).toEqual([3000, 0, 3000]);
    expect(r.suggested).toBe(2000);
  });
});

describe("buildForecast: суммы", () => {
  it("медиана не даёт одному выбросу задрать план", () => {
    const txs = [
      tx({ date: "2026-03-10", amountBase: 1000 }),
      tx({ date: "2026-04-10", amountBase: 1000 }),
      tx({ date: "2026-05-10", amountBase: 100_000 }),
    ];
    const avg = buildForecast(txs, [], "2026-06", opts)[0];
    const med = buildForecast(txs, [], "2026-06", { months: 3, basis: "median" })[0];
    expect(avg.suggested).toBe(34_000);
    expect(med.suggested).toBe(1000);
  });

  it("возвраты уменьшают факт месяца", () => {
    const txs = [
      tx({ date: "2026-05-10", amountBase: 5000 }),
      tx({ date: "2026-05-11", amountBase: 2000, kind: "refund" }),
    ];
    const [r] = buildForecast(txs, [], "2026-06", { months: 1, basis: "average" });
    expect(r.suggested).toBe(3000);
  });

  it("переводы в бюджет не попадают", () => {
    const txs = [tx({ date: "2026-05-10", amountBase: 50_000, kind: "transfer" })];
    expect(buildForecast(txs, [], "2026-06", opts)).toEqual([]);
  });

  it("«Без категории» не статья бюджета", () => {
    const txs = [tx({ date: "2026-05-10", amountBase: 5000, category: "Без категории" })];
    expect(buildForecast(txs, [], "2026-06", opts)).toEqual([]);
  });

  it("суммы ниже шага округления не становятся планом", () => {
    const txs = [tx({ date: "2026-05-10", amountBase: 40 })];
    expect(buildForecast(txs, [], "2026-06", { months: 1, basis: "average" })).toEqual([]);
  });

  it("категория, ушедшая в минус возвратами, плана не получает", () => {
    const txs = [
      tx({ date: "2026-05-10", amountBase: 1000 }),
      tx({ date: "2026-05-11", amountBase: 4000, kind: "refund" }),
    ];
    expect(buildForecast(txs, [], "2026-06", { months: 1, basis: "average" })).toEqual([]);
  });
});

describe("buildForecast: периметр", () => {
  it("считает только счета периметра и переводы через его границу", () => {
    const txs = [
      tx({ date: "2026-05-01", amountBase: 1000, account: "Карта" }),
      tx({ date: "2026-05-02", amountBase: 9000, account: "Наличные" }),
      tx({
        date: "2026-05-03",
        kind: "transfer",
        category: "Переводы",
        account: "Карта",
        outcomeAccount: "Карта",
        incomeAccount: "Накопительный",
        amountBase: 30_000,
      }),
    ];
    const rows = buildForecast(txs, [], "2026-06", {
      months: 1,
      basis: "average",
      scope: { accounts: new Set(["Карта"]), perimeterTransfers: true },
    });
    expect(rows.map((r) => [r.category, r.subcategory, r.suggested])).toEqual([
      ["Переводы", "Накопительный", 30_000],
      ["Еда", null, 1000],
    ]);
  });
});

describe("buildForecast: статьи", () => {
  it("родитель и под-категория считаются раздельно", () => {
    const txs = [
      tx({ date: "2026-05-10", amountBase: 1000 }),
      tx({ date: "2026-05-11", amountBase: 3000, subcategory: "Кафе" }),
    ];
    const rows = buildForecast(txs, [], "2026-06", { months: 1, basis: "average" });
    expect(rows.map((r) => [r.subcategory, r.suggested])).toEqual([
      ["Кафе", 3000],
      [null, 1000],
    ]);
  });

  it("доходы и расходы — разные статьи, даже под одним тегом", () => {
    const txs = [
      tx({ date: "2026-05-10", amountBase: 1000, category: "Банки" }),
      tx({ date: "2026-05-11", amountBase: 2000, category: "Банки", kind: "income" }),
    ];
    const rows = buildForecast(txs, [], "2026-06", { months: 1, basis: "average" });
    expect(rows.map((r) => [r.kind, r.suggested])).toEqual([
      ["income", 2000],
      ["expense", 1000],
    ]);
  });

  it("подставляет текущий план целевого месяца", () => {
    const txs = [tx({ date: "2026-05-10", amountBase: 1000 })];
    const lines = [line({ overrides: { "2026-06": 7000 } })];
    const [r] = buildForecast(txs, lines, "2026-06", { months: 1, basis: "average" });
    expect(r.current).toBe(7000);
    expect(r.key).toBe(tagKey("expense", "Еда", null));
  });

  it("план из другого месяца целевому не приписывается", () => {
    const txs = [tx({ date: "2026-05-10", amountBase: 1000 })];
    const lines = [line({ startMonth: "2026-07" })];
    const [r] = buildForecast(txs, lines, "2026-06", { months: 1, basis: "average" });
    expect(r.current).toBe(0);
  });
});

describe("previousPlan", () => {
  it("копирует план прошлого месяца, а не его факт", () => {
    const lines = [line({ overrides: { "2026-05": 7000, "2026-06": 0 } })];
    const [r] = previousPlan(lines, "2026-06");
    expect(r.suggested).toBe(7000);
    expect(r.current).toBe(0);
    expect(r.monthsUsed).toBe(1);
  });

  it("статьи без плана в прошлом месяце не предлагает", () => {
    const lines = [line({ overrides: { "2026-04": 5000 } })];
    expect(previousPlan(lines, "2026-06")).toEqual([]);
  });

  it("подставляет текущий план целевого месяца — видно, что заменяем", () => {
    const lines = [line({ overrides: { "2026-05": 7000, "2026-06": 9000 } })];
    expect(previousPlan(lines, "2026-06")[0].current).toBe(9000);
  });

  it("родитель и под-категория копируются раздельно", () => {
    const lines = [
      line({ overrides: { "2026-05": 7000 } }),
      line({ subcategory: "Кафе", overrides: { "2026-05": 3000 } }),
    ];
    expect(previousPlan(lines, "2026-06").map((r) => [r.subcategory, r.suggested])).toEqual([
      [null, 7000],
      ["Кафе", 3000],
    ]);
  });

  it("совпадающую сумму «Только без плана» отсеивает, «Все статьи» — нет", () => {
    const lines = [line({ overrides: { "2026-05": 7000, "2026-06": 7000 } })];
    const rows = previousPlan(lines, "2026-06");
    expect(forecastChanges(rows, "empty")).toEqual([]);
    expect(forecastChanges(rows, "all")).toEqual([]);
  });
});

describe("forecastChanges", () => {
  const txs = [
    tx({ date: "2026-05-10", amountBase: 1000 }),
    tx({ date: "2026-05-11", amountBase: 5000, category: "Дом" }),
  ];
  const lines = [line({ overrides: { "2026-06": 900 } })];
  const rows = buildForecast(txs, lines, "2026-06", { months: 1, basis: "average" });

  it("«только без плана» не трогает уже спланированное", () => {
    expect(forecastChanges(rows, "empty").map((r) => r.category)).toEqual(["Дом"]);
  });

  it("«все статьи» переписывает и спланированное", () => {
    expect(forecastChanges(rows, "all").map((r) => r.category)).toEqual(["Дом", "Еда"]);
  });

  it("совпадающую сумму не считает изменением", () => {
    const same = buildForecast(txs, [line({ overrides: { "2026-06": 1000 } })], "2026-06", {
      months: 1,
      basis: "average",
    });
    expect(forecastChanges(same, "all").map((r) => r.category)).toEqual(["Дом"]);
  });
});
