import { describe, expect, it } from "vitest";
import {
  budgetFactHits,
  budgetMonthTotals,
  budgetPlanRows,
  budgetUnplannedRows,
  openingBudgetRow,
  rowPlanForTotal,
  type BudgetMonthRow,
  type BudgetMonthSources,
} from "./budgetMonth";
import type { BudgetLine } from "./budgets";
import { ALL_ACCOUNTS, type BudgetScope } from "./budgetScope";
import { categoryPathKey } from "./budgetYear";
import { buildZenPlanRules, zenPlanSettings, type PlanAccount } from "./zenPlanRules";
import { zenPlanKey } from "./zenBudgets";
import { NO_CATEGORY } from "./zenmoneyMap";
import type { PlannedPlan } from "./plannedPlans";
import type { Transaction } from "../types";
import { tx } from "../test/fixtures";

let n = 0;
const line = (over: Partial<BudgetLine> = {}): BudgetLine => ({
  id: `l${++n}`,
  category: "Еда",
  subcategory: null,
  kind: "expense",
  amount: 1000,
  recurrence: "monthly",
  startMonth: "2026-01",
  endMonth: null,
  createdAt: "2026-01-01",
  ...over,
});

function src(lines: BudgetLine[], txs: Transaction[] = [], over: Partial<BudgetMonthSources> = {}): BudgetMonthSources {
  return {
    lines,
    transactions: txs,
    monthStartDay: 1,
    zenForecasts: new Map(),
    zenLoaded: true,
    zenRules: null,
    plannedAsPlan: [],
    livePaths: null,
    rowOrder: "alpha",
    ...over,
  };
}

const planned = (over: Partial<PlannedPlan>): PlannedPlan => ({
  kind: "expense",
  category: "Еда",
  subcategory: null,
  ym: "2026-03",
  amount: 0,
  ahead: 0,
  aheadOps: [],
  ...over,
});

const names = (rows: BudgetMonthRow[]) =>
  rows.map((r) => (r.line.subcategory ? `${r.line.category}/${r.line.subcategory}` : r.line.category));

describe("budgetPlanRows — статьи с планом", () => {
  it("статья живёт только внутри своего окна [startMonth, endMonth]", () => {
    const lines = [line({ startMonth: "2026-04" }), line({ category: "Дом", endMonth: "2026-02" }), line({ category: "Кафе" })];
    expect(names(budgetPlanRows(src(lines), "2026-03", ALL_ACCOUNTS))).toEqual(["Кафе"]);
  });

  it("месяц без плана (разовая статья в другом месяце) строку не даёт", () => {
    const lines = [line({ recurrence: "once", startMonth: "2026-02", endMonth: "2026-02" })];
    expect(budgetPlanRows(src(lines), "2026-02", ALL_ACCOUNTS)).toHaveLength(1);
    expect(budgetPlanRows(src(lines), "2026-03", ALL_ACCOUNTS)).toHaveLength(0);
  });

  it("факт — траты месяца по статье; отчётный месяц со своим первым днём", () => {
    const txs = [
      tx({ date: "2026-03-09", amount: 100 }), // ещё февральский период при дне 10
      tx({ date: "2026-03-10", amount: 200 }),
      tx({ date: "2026-04-09", amount: 300 }),
      tx({ date: "2026-04-10", amount: 999 }),
    ];
    const [row] = budgetPlanRows(src([line()], txs, { monthStartDay: 10 }), "2026-03", ALL_ACCOUNTS);
    expect(row.fact).toBe(500);
  });

  it("категория забирает траты подкатегорий, кроме показанных своей строкой", () => {
    const lines = [line({ amount: 5000 }), line({ subcategory: "Фрукты", amount: 1000 })];
    const txs = [
      tx({ date: "2026-03-05", amount: 100 }),
      tx({ date: "2026-03-05", subcategory: "Фрукты", amount: 40 }),
      tx({ date: "2026-03-05", subcategory: "Хлеб", amount: 7 }),
    ];
    const rows = budgetPlanRows(src(lines, txs), "2026-03", ALL_ACCOUNTS);
    expect(rows.map((r) => [names([r])[0], r.fact])).toEqual([
      ["Еда", 107],
      ["Еда/Фрукты", 40],
    ]);
  });

  describe("прогноз вместо пустого плана", () => {
    const zero = line({ amount: 0, category: "Зарплата", kind: "income" });
    const key = zenPlanKey("income", "Зарплата", null, "2026-03");

    it("с подключением — прогноз Дзен-мани, если прогнозы включены в «Планах»", () => {
      const rules = buildZenPlanRules([], { ...zenPlanSettings({}), forecasts: true }, []);
      const rows = budgetPlanRows(
        src([zero], [], { zenForecasts: new Map([[key, 70_000]]), zenRules: rules }),
        "2026-03",
        ALL_ACCOUNTS
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ planned: 70_000, forecast: true });
    });

    it("прогнозы выключены — статьи без плана нет", () => {
      const rules = buildZenPlanRules([], { ...zenPlanSettings({}), forecasts: false }, []);
      const rows = budgetPlanRows(src([zero], [], { zenForecasts: new Map([[key, 70_000]]), zenRules: rules }), "2026-03", ALL_ACCOUNTS);
      expect(rows).toEqual([]);
    });

    it("кэш прогнозов ещё читается — не показываем ничего, а не медиану", () => {
      const txs = [1, 2].map((m) => tx({ date: `2026-0${m}-05`, kind: "income", category: "Зарплата", amount: 50_000 }));
      const rows = budgetPlanRows(src([zero], txs, { zenForecasts: null, zenLoaded: false }), "2026-03", ALL_ACCOUNTS);
      expect(rows).toEqual([]);
    });

    it("без подключения — своя медиана, и только у доходов", () => {
      const salary = (m: number) => tx({ date: `2026-0${m}-05`, kind: "income", category: "Зарплата", amount: 50_000 });
      const food = (m: number) => tx({ date: `2026-0${m}-05`, amount: 9_000 });
      const txs = [...[1, 2].flatMap((m) => [salary(m), food(m)])];
      const lines = [zero, line({ amount: 0 })];
      const rows = budgetPlanRows(src(lines, txs, { zenForecasts: null }), "2026-03", ALL_ACCOUNTS);
      // Медиана шести месяцев, где четыре пустых, — ноль; берём три полных из шести.
      expect(rows).toEqual([]);
      const many = [1, 2, 3, 4, 5].flatMap((m) => [salary(m), food(m)]);
      const rows2 = budgetPlanRows(src(lines, many, { zenForecasts: null }), "2026-06", ALL_ACCOUNTS);
      expect(names(rows2)).toEqual(["Зарплата"]);
      expect(rows2[0]).toMatchObject({ planned: 50_000, forecast: true });
    });
  });

  it("назначенная операция даёт план статье без своего плана, но не поверх своего", () => {
    const lines = [line({ amount: 1000 })];
    const plans = [
      planned({ amount: 300 }), // у «Еды» план есть — назначенная уже внутри него
      planned({ category: "Связь", amount: 600 }),
      planned({ category: "Связь", amount: 999, ym: "2026-04" }), // не этот месяц
    ];
    const rows = budgetPlanRows(src(lines, [], { plannedAsPlan: plans }), "2026-03", ALL_ACCOUNTS);
    expect(rows.map((r) => [names([r])[0], r.planned, !!r.scheduled])).toEqual([
      ["Еда", 1000, false],
      ["Связь", 600, true],
    ]);
  });

  it("призрак переименования: имени нет в справочнике и трат нет — строку прячем", () => {
    const lines = [line({ category: "Старое" }), line({ category: "Еда" })];
    const live = new Set([categoryPathKey("Еда", null)]);
    expect(names(budgetPlanRows(src(lines, [], { livePaths: live }), "2026-03", ALL_ACCOUNTS))).toEqual(["Еда"]);
    // С тратами за месяц строка остаётся — деньги должны быть видны.
    const txs = [tx({ date: "2026-03-02", category: "Старое", amount: 10 })];
    expect(names(budgetPlanRows(src(lines, txs, { livePaths: live }), "2026-03", ALL_ACCOUNTS))).toEqual(["Еда", "Старое"]);
  });

  it("порядок: по алфавиту или по сумме, подкатегории сразу под своей категорией", () => {
    const lines = [
      line({ category: "Авто" }),
      line({ category: "Еда" }),
      line({ category: "Еда", subcategory: "Хлеб" }),
      line({ category: "Еда", subcategory: "Сыр" }),
    ];
    const txs = [
      tx({ date: "2026-03-01", category: "Авто", amount: 10 }),
      tx({ date: "2026-03-01", subcategory: "Хлеб", amount: 500 }),
      tx({ date: "2026-03-01", subcategory: "Сыр", amount: 100 }),
    ];
    expect(names(budgetPlanRows(src(lines, txs), "2026-03", ALL_ACCOUNTS))).toEqual(["Авто", "Еда", "Еда/Сыр", "Еда/Хлеб"]);
    expect(names(budgetPlanRows(src(lines, txs, { rowOrder: "amount" }), "2026-03", ALL_ACCOUNTS))).toEqual([
      "Еда",
      "Еда/Хлеб",
      "Еда/Сыр",
      "Авто",
    ]);
  });
});

describe("budgetFactHits — «Без категории» тоже деньги", () => {
  it("трата и доход без категории ложатся строкой «Без категории»", () => {
    expect(budgetFactHits(tx({ category: "", amount: 50 }), ALL_ACCOUNTS)).toEqual([
      { kind: "expense", category: NO_CATEGORY, subcategory: null, amount: 50 },
    ]);
    expect(budgetFactHits(tx({ category: NO_CATEGORY, kind: "income", amount: 70 }), ALL_ACCOUNTS)).toEqual([
      { kind: "income", category: NO_CATEGORY, subcategory: null, amount: 70 },
    ]);
  });

  it("счёт вне периметра — мимо бюджета", () => {
    const scope: BudgetScope = { accounts: new Set(["Наличные"]), perimeterTransfers: false };
    expect(budgetFactHits(tx({ category: "", account: "Карта" }), scope)).toEqual([]);
  });

  it("операция с категорией идёт обычным правилом", () => {
    expect(budgetFactHits(tx({ category: "Еда", amount: 5 }), ALL_ACCOUNTS)).toEqual([
      { kind: "expense", category: "Еда", subcategory: null, amount: 5 },
    ]);
  });
});

describe("budgetUnplannedRows — траты без плана", () => {
  it("статья без плана — строка с планом 0; «Без категории» планировать нельзя", () => {
    const rows = budgetPlanRows(src([line()]), "2026-03", ALL_ACCOUNTS);
    const txs = [
      tx({ date: "2026-03-03", category: "Кафе", amount: 300 }),
      tx({ date: "2026-03-03", category: "", amount: 20 }),
      tx({ date: "2026-03-03", category: "Еда", amount: 1 }), // есть строка с планом
      tx({ date: "2026-04-03", category: "Кафе", amount: 999 }), // другой месяц
    ];
    const un = budgetUnplannedRows(src([], txs), "2026-03", ALL_ACCOUNTS, rows);
    expect(un.map((r) => [r.line.category, r.planned, r.fact, r.plannable])).toEqual([
      ["Кафе", 0, 300, true],
      [NO_CATEGORY, 0, 20, false],
    ]);
    expect(un.every((r) => r.unplanned)).toBe(true);
  });

  it("подкатегория не «без плана», если план есть у её категории", () => {
    const rows = budgetPlanRows(src([line()]), "2026-03", ALL_ACCOUNTS);
    const txs = [tx({ date: "2026-03-03", subcategory: "Хлеб", amount: 30 })];
    expect(budgetUnplannedRows(src([], txs), "2026-03", ALL_ACCOUNTS, rows)).toEqual([]);
  });

  it("возврат, погасивший трату до нуля, строку не даёт", () => {
    const txs = [
      tx({ date: "2026-03-03", category: "Кафе", amount: 300 }),
      tx({ date: "2026-03-04", category: "Кафе", kind: "refund", amount: 300 }),
    ];
    expect(budgetUnplannedRows(src([], txs), "2026-03", ALL_ACCOUNTS, [])).toEqual([]);
  });

  it("переводы «по своим правилам» не статья: в строки не попадают", () => {
    const scope: BudgetScope = { accounts: new Set(), perimeterTransfers: true };
    const t = tx({ date: "2026-03-03", kind: "transfer", outcomeAccount: "Карта", incomeAccount: "Вклад", amount: 1000 });
    expect(budgetUnplannedRows(src([], [t]), "2026-03", scope, [])).toEqual([]);
  });

  it("перевод через границу баланса по «Планам» — группа с родителем и подстрокой счёта", () => {
    const acc = (title: string, p: Partial<PlanAccount> = {}): PlanAccount => ({
      title,
      type: "ccard",
      savings: false,
      creditLimit: 0,
      inBalance: true,
      ...p,
    });
    const zen = buildZenPlanRules(
      [acc("Карта"), acc("Вклад", { type: "deposit", savings: true, inBalance: false })],
      zenPlanSettings({ planBalanceMode: "balance" }),
      []
    );
    const scope: BudgetScope = { accounts: new Set(), perimeterTransfers: false, zen };
    const t = tx({
      date: "2026-03-03",
      kind: "transfer",
      outcomeAccount: "Карта",
      incomeAccount: "Вклад",
      account: "Карта",
      amountBase: 10_000,
    });
    const un = budgetUnplannedRows(src([], [t]), "2026-03", scope, []);
    const parent = un.find((r) => r.line.subcategory === null)!;
    const child = un.find((r) => r.line.subcategory === "Вклад")!;
    expect(parent).toMatchObject({ planGroup: true, fact: 0, plannable: false });
    expect(child).toMatchObject({ planGroup: true, fact: 10_000, plannable: false });
    expect(child.line.category).toBe(parent.line.category);
  });
});

describe("openingBudgetRow и итоги месяца", () => {
  it("входящий баланс: нет — нет строки; будущий месяц — прогноз", () => {
    expect(openingBudgetRow(null, "2026-03", "2026-03")).toBeNull();
    expect(openingBudgetRow(5000, "2026-03", "2026-03")).toMatchObject({ planned: 5000, fact: 5000, forecast: false, opening: true });
    expect(openingBudgetRow(5000, "2026-04", "2026-03")!.forecast).toBe(true);
  });

  it("план подкатегории под категорией с замком в итог не прибавляется", () => {
    const rows = budgetPlanRows(
      src([line({ amount: 3000, locks: { "2026-03": true } }), line({ subcategory: "Хлеб", amount: 500 })]),
      "2026-03",
      ALL_ACCOUNTS
    );
    const planOf = rowPlanForTotal(rows);
    expect(rows.map(planOf)).toEqual([3000, 0]);
    // Без замка — обычная сумма.
    const open = budgetPlanRows(src([line({ amount: 3000 }), line({ subcategory: "Хлеб", amount: 500 })]), "2026-03", ALL_ACCOUNTS);
    expect(open.map(rowPlanForTotal(open))).toEqual([3000, 500]);
  });

  it("разница: без входящего баланса; перевод наружу — отток, внутри — гасится", () => {
    const scope: BudgetScope = { accounts: new Set(["Карта"]), perimeterTransfers: true };
    const s = src([line(), line({ category: "Зарплата", kind: "income", amount: 9000 })], [
      tx({ date: "2026-03-01", amount: 800 }),
      tx({ date: "2026-03-02", kind: "income", category: "Зарплата", amount: 9000 }),
      tx({ date: "2026-03-03", kind: "transfer", outcomeAccount: "Карта", incomeAccount: "Вклад", account: "Карта", amount: 2000 }),
    ]);
    const rows = budgetPlanRows(s, "2026-03", scope);
    const open = openingBudgetRow(4000, "2026-03", "2026-03")!;
    const t = budgetMonthTotals([open, ...rows], s, "2026-03", scope);
    expect(t.opening).toBe(4000);
    expect(t.income).toEqual({ plan: 13_000, fact: 13_000 });
    expect(t.expense).toEqual({ plan: 1000, fact: 800 });
    expect(t.transfers).toEqual({ income: 0, expense: 2000 });
    expect(t.delta).toEqual({ plan: 8000, fact: 9000 - 800 - 2000 });
  });
});
