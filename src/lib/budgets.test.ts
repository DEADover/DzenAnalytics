import { describe, it, expect } from "vitest";
import { monthDiff, addMonths, planTotals, plannedFor, monthlyEquivalent, factFor, forecastFor, buildMonthCashflow, migrateLegacyBudgets, type BudgetLine, ownSubsIndex, ownSubsFor } from "./budgets";
import { tx } from "../test/fixtures";

const line = (over: Partial<BudgetLine> = {}): BudgetLine => ({
  id: "1",
  category: "Еда",
  kind: "expense",
  amount: 10000,
  recurrence: "monthly",
  startMonth: "2026-01",
  endMonth: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("monthDiff / addMonths", () => {
  it("counts whole months between YYYY-MM", () => {
    expect(monthDiff("2026-01", "2026-04")).toBe(3);
    expect(monthDiff("2026-04", "2026-01")).toBe(-3);
    expect(monthDiff("2025-11", "2026-02")).toBe(3);
  });
  it("adds months across year boundaries", () => {
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(addMonths("2026-03", -5)).toBe("2025-10");
  });
});

describe("plannedFor", () => {
  it("monthly: amount every month inside the window", () => {
    const l = line({ recurrence: "monthly", startMonth: "2026-01", endMonth: "2026-12" });
    expect(plannedFor(l, "2026-01")).toBe(10000);
    expect(plannedFor(l, "2026-07")).toBe(10000);
    expect(plannedFor(l, "2025-12")).toBe(0); // before start
    expect(plannedFor(l, "2027-01")).toBe(0); // after end
  });

  it("quarterly: lands on every 3rd month from start, zero elsewhere", () => {
    const l = line({ recurrence: "quarterly", amount: 30000, startMonth: "2026-02" });
    expect(plannedFor(l, "2026-02")).toBe(30000);
    expect(plannedFor(l, "2026-03")).toBe(0);
    expect(plannedFor(l, "2026-05")).toBe(30000);
    expect(plannedFor(l, "2026-08")).toBe(30000);
  });

  it("yearly: lands once a year on the anchor month", () => {
    const l = line({ recurrence: "yearly", amount: 60000, startMonth: "2026-03" });
    expect(plannedFor(l, "2026-03")).toBe(60000);
    expect(plannedFor(l, "2026-09")).toBe(0);
    expect(plannedFor(l, "2027-03")).toBe(60000);
  });

  it("once: only the start month", () => {
    const l = line({ recurrence: "once", amount: 5000, startMonth: "2026-04" });
    expect(plannedFor(l, "2026-04")).toBe(5000);
    expect(plannedFor(l, "2026-05")).toBe(0);
  });

  it("override beats the computed plan for that month", () => {
    const l = line({ recurrence: "monthly", overrides: { "2026-03": 25000 } });
    expect(plannedFor(l, "2026-02")).toBe(10000);
    expect(plannedFor(l, "2026-03")).toBe(25000);
  });

  it("override of 0 explicitly zeroes a month", () => {
    const l = line({ recurrence: "monthly", overrides: { "2026-03": 0 } });
    expect(plannedFor(l, "2026-03")).toBe(0);
  });
});

describe("monthlyEquivalent", () => {
  it("spreads quarterly/yearly, passes monthly, zeroes one-off", () => {
    expect(monthlyEquivalent(line({ recurrence: "monthly", amount: 9000 }))).toBe(9000);
    expect(monthlyEquivalent(line({ recurrence: "quarterly", amount: 9000 }))).toBe(3000);
    expect(monthlyEquivalent(line({ recurrence: "yearly", amount: 12000 }))).toBe(1000);
    expect(monthlyEquivalent(line({ recurrence: "once", amount: 9000 }))).toBe(0);
  });
});

describe("factFor", () => {
  const txs = [
    tx({ category: "Еда", kind: "expense", amountBase: 1000, date: "2026-03-05" }),
    tx({ category: "Еда", kind: "refund", amountBase: 300, date: "2026-03-10" }),
    tx({ category: "Еда", kind: "expense", amountBase: 500, date: "2026-04-01" }),
    tx({ category: "Зарплата", kind: "income", amountBase: 90000, date: "2026-03-25" }),
  ];

  it("expense line nets refunds within the month", () => {
    expect(factFor(line({ category: "Еда" }), txs, "2026-03")).toBe(700); // 1000 − 300
    expect(factFor(line({ category: "Еда" }), txs, "2026-04")).toBe(500);
  });

  it("income line sums income for the category/month", () => {
    const l = line({ category: "Зарплата", kind: "income" });
    expect(factFor(l, txs, "2026-03")).toBe(90000);
    expect(factFor(l, txs, "2026-04")).toBe(0);
  });

  it("план на категорию проедается тратами по её под-категориям (#70)", () => {
    // Человек, который не готов делить «Медицину» на «Лекарства» и «Лечение»,
    // планирует саму категорию. Раньше такой план видел только операции,
    // помеченные категорией напрямую, и уезжал в «Без трат в этом месяце».
    const mixed = [
      tx({ category: "Еда", subcategory: null, kind: "expense", amountBase: 1000, date: "2026-03-05" }),
      tx({ category: "Еда", subcategory: "Алкоголь", kind: "expense", amountBase: 400, date: "2026-03-06" }),
    ];
    expect(factFor(line({ category: "Еда", subcategory: null }), mixed, "2026-03")).toBe(1400);
    // Строка под-категории по-прежнему считает только свой тег.
    expect(factFor(line({ category: "Еда", subcategory: "Алкоголь" }), mixed, "2026-03")).toBe(400);
  });

  it("под-категория со своим бюджетом не считается дважды", () => {
    // Иначе 400 ₽ попали бы и в строку «Алкоголь», и в итог «Еды».
    const mixed = [
      tx({ category: "Еда", subcategory: null, kind: "expense", amountBase: 1000, date: "2026-03-05" }),
      tx({ category: "Еда", subcategory: "Алкоголь", kind: "expense", amountBase: 400, date: "2026-03-06" }),
    ];
    const lines = [
      line({ category: "Еда", subcategory: null }),
      line({ category: "Еда", subcategory: "Алкоголь" }),
    ];
    const idx = ownSubsIndex(lines.map((l) => ({ line: l, planned: 5000 })));
    expect(factFor(lines[0], mixed, "2026-03", undefined, ownSubsFor(idx, lines[0]))).toBe(1000);
    expect(factFor(lines[1], mixed, "2026-03", undefined, ownSubsFor(idx, lines[1]))).toBe(400);
  });

  it("под-категория с нулевым планом траты у категории не забирает (#70)", () => {
    // Строка с планом 0 на экране не показывается. Если категория всё равно
    // отдаёт ей траты, деньги исчезают отовсюду: под-строки нет, а «Еда»
    // уезжает в «Без трат в этом месяце» с фактом 0.
    const mixed = [
      tx({ category: "Еда", subcategory: "Алкоголь", kind: "expense", amountBase: 400, date: "2026-03-06" }),
    ];
    const parent = line({ category: "Еда", subcategory: null });
    const idx = ownSubsIndex([
      { line: parent, planned: 5000 },
      { line: line({ category: "Еда", subcategory: "Алкоголь" }), planned: 0 },
    ]);
    expect(factFor(parent, mixed, "2026-03", undefined, ownSubsFor(idx, parent))).toBe(400);
  });

  it("чужая категория в индекс не попадает", () => {
    const idx = ownSubsIndex([
      { line: line({ category: "Дом", subcategory: "Ремонт" }), planned: 5000 },
    ]);
    expect(ownSubsFor(idx, line({ category: "Еда", subcategory: null }))).toBeUndefined();
  });

  it("доходная и расходная строки не путаются", () => {
    const idx = ownSubsIndex([
      { line: line({ category: "Еда", subcategory: "Алкоголь", kind: "income" }), planned: 5000 },
    ]);
    expect(ownSubsFor(idx, line({ category: "Еда", subcategory: null, kind: "expense" }))).toBeUndefined();
  });
});

describe("forecastFor", () => {
  const incLine = line({ category: "Проценты", kind: "income" });
  const inc = (date: string, amt: number) =>
    tx({ category: "Проценты", kind: "income", amountBase: amt, date });

  it("median of the prior months, rounded to 100", () => {
    // Last 6 months before 2026-06: May…Dec, all ~26 000 → median rounded to 100.
    const txs = [
      inc("2026-05-10", 26100),
      inc("2026-04-10", 26000),
      inc("2026-03-10", 26200),
      inc("2026-02-10", 25900),
      inc("2026-01-10", 26050),
      inc("2025-12-10", 26300),
    ];
    expect(forecastFor(incLine, txs, "2026-06")).toBe(26100);
  });

  it("no forecast for sporadic income (median below 100 → 0)", () => {
    // Income only once in the window → median of the six months is 0.
    const txs = [inc("2026-03-10", 50000)];
    expect(forecastFor(incLine, txs, "2026-06")).toBe(0);
  });

  it("ignores the current and future months — only looks back", () => {
    const txs = [inc("2026-06-10", 99999), inc("2026-07-10", 99999)];
    expect(forecastFor(incLine, txs, "2026-06")).toBe(0);
  });
});

describe("buildMonthCashflow", () => {
  // "Today" = 15 June 2026 → half the month elapsed.
  const now = new Date("2026-06-15T12:00:00").getTime();
  const txs = [
    tx({ category: "З/п", kind: "income", amountBase: 100000, date: "2026-06-05" }),
    tx({ category: "Еда", kind: "expense", amountBase: 20000, date: "2026-06-10" }),
    tx({ category: "Еда", kind: "expense", amountBase: 10000, date: "2026-06-14" }),
  ];

  it("splits actual vs forecast at today and projects at the daily pace", () => {
    const cf = buildMonthCashflow(txs, "2026-06", now);
    expect(cf.days).toBe(30);
    expect(cf.todayDay).toBe(15);
    expect(cf.factIncome).toBe(100000);
    expect(cf.factExpense).toBe(30000);
    // Pace × full month: expense 30000/15 × 30 = 60000; income 100000/15 × 30 ≈ 200000.
    expect(cf.projExpense).toBeCloseTo(60000, 0);
    expect(cf.projIncome).toBeCloseTo(200000, 0);
    // Day 15 carries BOTH actual and forecast so the segments join.
    const d15 = cf.points.find((p) => p.day === 15)!;
    expect(d15.expense).toBe(30000);
    expect(d15.expenseF).toBe(30000);
    // After today: actual is null, forecast non-null.
    const d30 = cf.points.find((p) => p.day === 30)!;
    expect(d30.expense).toBeNull();
    expect(d30.expenseF).toBeCloseTo(60000, 0);
  });

  it("a past month is fully actual — no forecast segment", () => {
    const cf = buildMonthCashflow(txs.map((t) => ({ ...t, date: t.date })), "2026-06", new Date("2026-08-01").getTime());
    expect(cf.todayDay).toBe(30);
    expect(cf.projExpense).toBe(30000); // equals the actual total
    expect(cf.points.every((p) => p.expenseF === null || p.day === 30)).toBe(true);
  });
});

describe("migrateLegacyBudgets", () => {
  it("turns flat limits into open-ended monthly expense lines", () => {
    const lines = migrateLegacyBudgets({ Еда: 10000, Транспорт: 5000, Пустой: 0 }, "2026-06", 111);
    expect(lines).toHaveLength(2); // zero-amount dropped
    expect(lines[0]).toMatchObject({
      category: "Еда",
      kind: "expense",
      amount: 10000,
      recurrence: "monthly",
      startMonth: "2026-06",
      endMonth: null,
    });
  });

  it("returns [] for null/empty input", () => {
    expect(migrateLegacyBudgets(null, "2026-06")).toEqual([]);
    expect(migrateLegacyBudgets({}, "2026-06")).toEqual([]);
  });
});

describe("запланированные операции на графике месяца (#72)", () => {
  const day = (d: number, kind: "income" | "expense", amt: number) =>
    tx({ date: `2026-08-${String(d).padStart(2, "0")}`, kind, amountBase: amt, amount: amt });
  const now = new Date(2026, 7, 7, 12).getTime(); // 7 августа

  it("зарплата 15-го рисуется ступенькой, а не размазывается", () => {
    const byDay = new Array(32).fill(0);
    byDay[15] = 90000;
    const flow = buildMonthCashflow([day(3, "expense", 1000)], "2026-08", now, {
      plannedIncomeByDay: byDay,
    });
    const at = (d: number) => flow.points.find((p) => p.day === d)!;
    // До 15-го дохода не обещаем, с 15-го — вся сумма сразу.
    expect(at(14).incomeF).toBe(0);
    expect(at(15).incomeF).toBe(90000);
    expect(at(31).incomeF).toBe(90000);
  });

  it("операция на прошедший день в прогноз не идёт", () => {
    // Она либо уже случилась и лежит в факте, либо не случилась — обещать её
    // задним числом неправильно.
    const byDay = new Array(32).fill(0);
    byDay[3] = 50000;
    const flow = buildMonthCashflow([], "2026-08", now, { plannedIncomeByDay: byDay });
    expect(flow.points.find((p) => p.day === 31)!.incomeF).toBe(0);
  });

  it("остаток плана, не покрытый операциями, идёт ровно", () => {
    const byDay = new Array(32).fill(0);
    byDay[15] = 40000;
    const flow = buildMonthCashflow([], "2026-08", now, {
      plannedIncome: 100000,
      plannedIncomeByDay: byDay,
    });
    const at = (d: number) => flow.points.find((p) => p.day === d)!.incomeF!;
    expect(at(31)).toBeCloseTo(100000, 6);
    // Ступенька видна: между 14-м и 15-м скачок больше ровного шага.
    expect(at(15) - at(14)).toBeGreaterThan(at(14) - at(13));
  });

  it("операции крупнее плана поднимают цель, а не обрезаются", () => {
    const byDay = new Array(32).fill(0);
    byDay[20] = 150000;
    const flow = buildMonthCashflow([], "2026-08", now, {
      plannedIncome: 100000,
      plannedIncomeByDay: byDay,
    });
    expect(flow.projIncome).toBe(150000);
  });

  it("без запланированных операций прогноз прежний", () => {
    const withNone = buildMonthCashflow([day(3, "income", 30000)], "2026-08", now, {
      plannedIncome: 90000,
    });
    expect(withNone.projIncome).toBe(90000);
    expect(withNone.points.find((p) => p.day === 31)!.incomeF).toBeCloseTo(90000, 6);
  });
});

/**
 * Отчётный месяц — тот же, что в приложении Дзен-мани.
 *
 * Ключ месяца («2026-09») приходит из Дзена как есть — это первое число
 * КАЛЕНДАРНОГО месяца, — а факт под этот ключ приложение собирает по отчётному
 * периоду: с первым днём 15 «Сентябрь» это 15.09–14.10, и траты 1–14 сентября
 * в него не входят.
 */
describe("отчётный месяц в бюджете", () => {
  const txs = [
    tx({ category: "Еда", kind: "expense", amountBase: 1000, date: "2026-09-10" }),
    tx({ category: "Еда", kind: "expense", amountBase: 2000, date: "2026-09-15" }),
    tx({ category: "Еда", kind: "expense", amountBase: 3000, date: "2026-09-18" }),
    tx({ category: "Еда", kind: "expense", amountBase: 4000, date: "2026-10-05" }),
    tx({ category: "Еда", kind: "expense", amountBase: 5000, date: "2026-10-20" }),
  ];
  const l = line({ category: "Еда" });

  it("при первом дне 15 факт «2026-09» — это 15.09–14.10", () => {
    // 15.09 и 18.09 внутри, 10.09 — уже прошлый период, 05.10 — ещё этот.
    expect(factFor(l, txs, "2026-09", undefined, undefined, 15)).toBe(2000 + 3000 + 4000);
    // Операция 10.09 ушла в «Август», а 20.10 — в «Октябрь».
    expect(factFor(l, txs, "2026-08", undefined, undefined, 15)).toBe(1000);
    expect(factFor(l, txs, "2026-10", undefined, undefined, 15)).toBe(5000);
  });

  it("при первом дне 1 всё по-старому — календарный месяц", () => {
    expect(factFor(l, txs, "2026-09")).toBe(1000 + 2000 + 3000);
    expect(factFor(l, txs, "2026-09", undefined, undefined, 1)).toBe(1000 + 2000 + 3000);
    expect(factFor(l, txs, "2026-10", undefined, undefined, 1)).toBe(4000 + 5000);
  });

  it("окно прогноза по истории тоже шагает отчётными месяцами", () => {
    // Медиана шести предыдущих периодов: у дня 1 в окно попадает вся тройка
    // сентябрьских трат, у дня 15 — только 10.09 (это «Август»).
    const hist = [
      tx({ category: "Прочее", kind: "income", amountBase: 6000, date: "2026-09-10" }),
      tx({ category: "Прочее", kind: "income", amountBase: 6000, date: "2026-08-20" }),
      tx({ category: "Прочее", kind: "income", amountBase: 6000, date: "2026-07-20" }),
    ];
    const inc = line({ category: "Прочее", kind: "income" });
    // Календарём три предыдущих месяца дают по 6000 — медиана 6000.
    expect(forecastFor(inc, hist, "2026-10", 3, undefined, 1)).toBe(6000);
    // С днём 15 те же три операции ложатся иначе: 10.09 переезжает в «Август»
    // к 20.08, а «Сентябрь» остаётся пустым — медиана [0, 6000, 12000] = 6000
    // при совсем другом раскладе по месяцам.
    // С днём 15 «Сентябрь» пуст, а 10.09 лежит в «Августе» вместе с 20.08.
    expect(factFor(inc, hist, "2026-09", undefined, undefined, 15)).toBe(0);
    expect(factFor(inc, hist, "2026-08", undefined, undefined, 15)).toBe(12000);
  });
});

describe("график движения денег по отчётному месяцу", () => {
  const txs = [
    tx({ category: "Еда", kind: "expense", amountBase: 1000, date: "2026-09-10" }),
    tx({ category: "Еда", kind: "expense", amountBase: 2000, date: "2026-09-15" }),
    tx({ category: "Еда", kind: "expense", amountBase: 3000, date: "2026-10-05" }),
  ];
  // «Сегодня» — 18 сентября, четвёртый день периода 15.09–14.10.
  const now = new Date(2026, 8, 18, 12).getTime();

  it("ось идёт от первого дня периода к последнему", () => {
    const cf = buildMonthCashflow(txs, "2026-09", now, { monthStartDay: 15 });
    expect(cf.days).toBe(30); // 15.09–14.10
    expect(cf.points[0].date).toBe("2026-09-15");
    expect(cf.points[cf.points.length - 1].date).toBe("2026-10-14");
  });

  it("«сегодня» — номер дня ВНУТРИ периода, а не число месяца", () => {
    const cf = buildMonthCashflow(txs, "2026-09", now, { monthStartDay: 15 });
    expect(cf.todayDay).toBe(4); // 15, 16, 17, 18 сентября
  });

  it("факт периода не включает траты до его начала", () => {
    const cf = buildMonthCashflow(txs, "2026-09", now, { monthStartDay: 15 });
    // 1000 от 10.09 — прошлый период; 3000 от 05.10 ещё впереди «сегодня».
    expect(cf.factExpense).toBe(2000);
  });

  it("при первом дне 1 всё по-старому", () => {
    const cf = buildMonthCashflow(txs, "2026-09", now);
    expect(cf.days).toBe(30);
    expect(cf.todayDay).toBe(18);
    expect(cf.factExpense).toBe(3000); // 10.09 + 15.09
    expect(cf.points[0].date).toBe("2026-09-01");
  });
});

// План на главной и в разделе «Бюджет» должен быть одним числом. Раньше главная
// складывала все строки подряд и задваивала под-статьи «запертого» родителя:
// 319 872 ₽ против 284 875 ₽ в самом разделе.
describe("planTotals — план месяца одним правилом", () => {
  it("под-статьи запертого родителя в итог не идут", () => {
    const lines = [
      line({ id: "p", category: "Животные", amount: 36000, locks: { "2026-09": true } }),
      line({ id: "s1", category: "Животные", subcategory: "Собака", amount: 25000 }),
      line({ id: "s2", category: "Животные", subcategory: "Кот", amount: 10000 }),
    ];
    expect(planTotals(lines, "2026-09").expense).toBe(36000);
  });

  it("родитель без замка складывается с детьми", () => {
    const lines = [
      line({ id: "p", category: "Еда", amount: 5000 }),
      line({ id: "s", category: "Еда", subcategory: "Алкоголь", amount: 1000 }),
    ];
    expect(planTotals(lines, "2026-09").expense).toBe(6000);
  });

  it("доход и расход считаются раздельно", () => {
    const lines = [
      line({ id: "i", category: "Работа", kind: "income", amount: 290000 }),
      line({ id: "e", category: "Еда", amount: 5000 }),
    ];
    expect(planTotals(lines, "2026-09")).toEqual({ income: 290000, expense: 5000 });
  });
});
