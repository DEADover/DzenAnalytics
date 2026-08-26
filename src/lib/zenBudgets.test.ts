import { describe, it, expect } from "vitest";
import {
  zenPlanList,
  zenPlansFromBudgets,
  zenForecastsFromBudgets,
  zenPlanKey,
  plannedOpsByTagMonth,
  fulfilledMarkerIds,
} from "./zenBudgets";
import type {
  ZenBudget,
  ZenInstrument,
  ZenReminderMarker,
  ZenTag,
} from "./zenmoney";

const tag = (id: string, title: string, parent: string | null = null): ZenTag => ({
  id,
  user: 1,
  changed: 0,
  title,
  parent,
  archive: false,
  showIncome: true,
  showOutcome: true,
  budgetIncome: true,
  budgetOutcome: true,
  required: null,
  color: null,
  icon: null,
  picture: null,
});

const budget = (b: Partial<ZenBudget>): ZenBudget => ({
  user: 1,
  changed: 0,
  date: "2026-06-01",
  tag: null,
  income: 0,
  incomeLock: false,
  outcome: 0,
  outcomeLock: false,
  ...b,
});

describe("zenPlansFromBudgets", () => {
  const tags = [tag("food", "Еда"), tag("shop", "Покупки"), tag("clothes", "Одежда", "shop")];

  it("maps a real outcome budget (lock=false, not a forecast) to category + month", () => {
    // Regression: real Zenmoney budgets leave `outcomeLock: false`; the manual
    // vs forecast distinction is `isOutcomeForecast`, not the lock.
    const m = zenPlansFromBudgets(
      [budget({ tag: "food", outcome: 5000, outcomeLock: false })],
      tags
    );
    expect(m.get(zenPlanKey("expense", "Еда", null, "2026-06"))).toBe(5000);
  });

  it("ignores auto-forecast and zero amounts", () => {
    const m = zenPlansFromBudgets(
      [
        budget({ tag: "food", outcome: 9999, isOutcomeForecast: true }), // forecast
        budget({ tag: "food", outcome: 0, date: "2026-07-01" }), // zero
      ],
      tags
    );
    expect(m.size).toBe(0);
  });

  it("keeps a sub-tag budget on its own (category=parent title, subcategory=sub title)", () => {
    const m = zenPlansFromBudgets([budget({ tag: "clothes", outcome: 3000 })], tags);
    // Per-tag: NOT rolled up into the parent — addressable as a sub-line.
    expect(m.get(zenPlanKey("expense", "Покупки", "Одежда", "2026-06"))).toBe(3000);
    expect(m.get(zenPlanKey("expense", "Покупки", null, "2026-06"))).toBeUndefined();
  });

  it("keeps parent and sub plans separate (no summing) and income apart", () => {
    const m = zenPlansFromBudgets(
      [
        budget({ tag: "clothes", outcome: 3000 }), // sub «Одежда»
        budget({ tag: "shop", outcome: 2000 }), // parent «Покупки»
        budget({ tag: "food", income: 1000 }),
      ],
      tags
    );
    expect(m.get(zenPlanKey("expense", "Покупки", "Одежда", "2026-06"))).toBe(3000);
    expect(m.get(zenPlanKey("expense", "Покупки", null, "2026-06"))).toBe(2000);
    expect(m.get(zenPlanKey("income", "Еда", null, "2026-06"))).toBe(1000);
  });

  it("skips the whole-month aggregate (tag null / all-zeros UUID) and unknown tags", () => {
    const m = zenPlansFromBudgets(
      [
        budget({ tag: null, outcome: 8000 }),
        budget({ tag: "00000000-0000-0000-0000-000000000000", outcome: 7000 }),
        budget({ tag: "ghost", outcome: 4000 }),
      ],
      tags
    );
    expect(m.size).toBe(0);
  });
});

describe("zenForecastsFromBudgets", () => {
  const tags = [tag("misc", "Прочее")];

  it("returns ONLY Zenmoney's auto-forecasts (the «из X» values), not manual plans", () => {
    const fc = zenForecastsFromBudgets(
      [
        budget({ tag: "misc", income: 17000, isIncomeForecast: true, date: "2026-07-01" }),
        budget({ tag: "misc", income: 20000, isIncomeForecast: false, date: "2026-06-01" }), // manual
      ],
      tags
    );
    expect(fc.get(zenPlanKey("income", "Прочее", null, "2026-07"))).toBe(17000);
    // The manual plan is NOT a forecast → excluded here.
    expect(fc.get(zenPlanKey("income", "Прочее", null, "2026-06"))).toBeUndefined();
  });

  it("is the complement of zenPlansFromBudgets (plans exclude forecasts)", () => {
    const budgets = [
      budget({ tag: "misc", income: 17000, isIncomeForecast: true, date: "2026-07-01" }),
    ];
    // The forecast shows up in forecasts, and NOT in manual plans.
    expect(zenForecastsFromBudgets(budgets, tags).size).toBe(1);
    expect(zenPlansFromBudgets(budgets, tags).size).toBe(0);
  });
});

describe("planned operations folding (unlocked budgets)", () => {
  const tags = [tag("work", "Работа")];
  const rub: ZenInstrument = { id: 2, title: "RUB", shortTitle: "RUB", symbol: "₽", rate: 1 };
  const usd: ZenInstrument = { id: 1, title: "USD", shortTitle: "USD", symbol: "$", rate: 90 };
  const marker = (m: Partial<ZenReminderMarker>): ZenReminderMarker => ({
    id: "m1",
    user: 1,
    changed: 0,
    date: "2026-07-25",
    income: 0,
    incomeInstrument: 2,
    outcome: 0,
    outcomeInstrument: 2,
    tag: ["work"],
    reminder: "r1",
    state: "planned",
    ...m,
  });

  it("adds planned income to an UNLOCKED budget (Работа: −22000 + 145000 = 123000)", () => {
    const planned = plannedOpsByTagMonth([marker({ income: 145000 })], [rub], 2, "2026-07-01");
    const m = zenPlansFromBudgets(
      [budget({ tag: "work", income: -22000, incomeLock: false, date: "2026-07-01" })],
      tags,
      planned
    );
    expect(m.get(zenPlanKey("income", "Работа", null, "2026-07"))).toBe(123000);
  });

  it("a LOCKED budget ignores planned ops (exact amount)", () => {
    const planned = plannedOpsByTagMonth([marker({ income: 145000 })], [rub], 2, "2026-07-01");
    const m = zenPlansFromBudgets(
      [budget({ tag: "work", income: 130000, incomeLock: true, date: "2026-07-01" })],
      tags,
      planned
    );
    expect(m.get(zenPlanKey("income", "Работа", null, "2026-07"))).toBe(130000);
  });

  it("исполненный план тоже в плане месяца, удалённый — нет", () => {
    // Проверено на живом аккаунте: у «Подписок» Дзен-мани показывает план
    // 25 045 = записанные 8 719,26 + 14 001,49 впереди + 2 325 уже
    // исполненных. План месяца — сколько всего собирались потратить.
    const planned = plannedOpsByTagMonth(
      [
        marker({ id: "a", income: 100000, state: "planned" }),
        marker({ id: "b", income: 50000, state: "processed" }),
        marker({ id: "c", income: 7000, state: "deleted" }),
      ],
      [rub],
      2,
      "2026-07-01"
    );
    expect(planned.get("work|2026-07")?.income).toBe(150000);
  });

  it("исполненный план считается и задним числом, а просроченный — нет", () => {
    // Разница между ними — в том, случилась операция или нет: у исполненной
    // есть факт, а просроченный план так и не сбылся.
    const planned = plannedOpsByTagMonth(
      [
        marker({ id: "past-done", income: 50_000, state: "processed", date: "2026-07-05" }),
        marker({ id: "past-stale", income: 33_000, state: "planned", date: "2026-07-05" }),
        marker({ id: "ahead", income: 20_000, state: "planned", date: "2026-07-25" }),
      ],
      [rub],
      2,
      "2026-07-11"
    );
    expect(planned.get("work|2026-07")?.income).toBe(70_000);
  });

  it("converts a foreign-currency planned op to base currency", () => {
    const planned = plannedOpsByTagMonth(
      [marker({ income: 1000, incomeInstrument: 1 })], // 1000 USD
      [rub, usd],
      2, // base RUB
      "2026-07-01"
    );
    expect(planned.get("work|2026-07")?.income).toBe(90000); // 1000 * 90 / 1
  });
});

describe("zenPlanList", () => {
  const tags = [tag("shop", "Покупки"), tag("clothes", "Одежда", "shop")];

  it("returns structured per-tag entries with subcategory", () => {
    const list = zenPlanList(
      [
        budget({ tag: "shop", outcome: 2000 }),
        budget({ tag: "clothes", outcome: 3000, date: "2026-05-01" }),
      ],
      tags
    );
    // Тег едет вместе с планом: по нему строка бюджета и опознаётся, а имена
    // могут смениться (категорию переименовали) — см. `budgetLines`.
    expect(list).toContainEqual({
      kind: "expense",
      tagId: "shop",
      category: "Покупки",
      subcategory: null,
      ym: "2026-06",
      amount: 2000,
      locked: false,
    });
    expect(list).toContainEqual({
      kind: "expense",
      tagId: "clothes",
      category: "Покупки",
      subcategory: "Одежда",
      ym: "2026-05",
      amount: 3000,
      locked: false,
    });
  });

  it("замок доезжает вместе с суммой", () => {
    // Замок меняет смысл числа у категории: залоченный план — это ВСЯ
    // категория, под-категории уже внутри него (у «Животных» в Дзен-мани так).
    const list = zenPlanList(
      [
        budget({ tag: "shop", outcome: 36_000, outcomeLock: true }),
        budget({ tag: "clothes", outcome: 25_000, outcomeLock: false }),
      ],
      tags
    );
    expect(list.find((e) => e.subcategory === null)?.locked).toBe(true);
    expect(list.find((e) => e.subcategory === "Одежда")?.locked).toBe(false);
  });
});

describe("живой случай «Работа»: сложение верно, мешают застрявшие планы", () => {
  const tagsWork = [tag("work", "Работа")];
  const rubW: ZenInstrument = { id: 2, title: "RUB", shortTitle: "RUB", symbol: "₽", rate: 1 };
  const mk = (id: string, income: number, date: string): ZenReminderMarker => ({
    id, user: 1, changed: 0, date, income, incomeInstrument: 2, outcome: 0,
    outcomeInstrument: 2, tag: ["work"], reminder: "r" + id, state: "planned",
  });

  it("план 145 000 плюс запланированный аванс 160 000 дают 305 000, как в Дзен-мани", () => {
    const planned = plannedOpsByTagMonth([mk("аванс", 160000, "2026-08-25")], [rubW], 2, "2026-08-01");
    const m = zenPlansFromBudgets(
      [budget({ tag: "work", income: 145000, incomeLock: false, date: "2026-08-01" })],
      tagsWork,
      planned
    );
    expect(m.get(zenPlanKey("income", "Работа", null, "2026-08"))).toBe(305000);
  });

  it("план уже пришедшей зарплаты второй раз не считается", () => {
    // Из-за него и выходило 465 900 вместо 305 000: зарплата пришла 10-го, её
    // план остался в кэше, и мы прибавляли его к факту. Дзен так не делает —
    // место исполненного плана занял факт.
    const planned = plannedOpsByTagMonth(
      [mk("аванс", 160000, "2026-08-25"), mk("зарплата-уже-пришла", 160900.33, "2026-08-10")],
      [rubW],
      2,
      "2026-08-11" // сегодня 11-е: зарплата позади, аванс впереди
    );
    const m = zenPlansFromBudgets(
      [budget({ tag: "work", income: 145000, incomeLock: false, date: "2026-08-01" })],
      tagsWork,
      planned
    );
    expect(m.get(zenPlanKey("income", "Работа", null, "2026-08"))).toBe(305000);
  });

  it("план сегодняшнего дня ещё считается — он мог не исполниться", () => {
    const planned = plannedOpsByTagMonth(
      [mk("сегодня", 50000, "2026-08-11")],
      [rubW],
      2,
      "2026-08-11"
    );
    expect(planned.get("work|2026-08")?.income).toBe(50000);
  });
});

describe("прогноз Дзена не прибавляется к плану", () => {
  const rubF: ZenInstrument = { id: 2, title: "RUB", shortTitle: "RUB", symbol: "₽", rate: 1 };
  const mkF = (id: string, income: number, isForecast: boolean): ZenReminderMarker => ({
    id, user: 1, changed: 0, date: "2026-08-25", income, incomeInstrument: 2,
    outcome: 0, outcomeInstrument: 2, tag: ["work"], reminder: "r" + id,
    state: "planned", isForecast,
  });

  it("считается только назначенная операция, не достроенная Дзеном", () => {
    const planned = plannedOpsByTagMonth(
      [mkF("аванс", 160000, false), mkF("прогноз-зарплаты", 160900.33, true)],
      [rubF],
      2,
      "2026-08-11"
    );
    expect(planned.get("work|2026-08")?.income).toBe(160000);
  });
});

describe("связанные плановые операции (issue #86)", () => {
  const rub = { id: 2, shortTitle: "RUB", title: "Рубль", symbol: "₽", rate: 1 };
  const mk = (over: Partial<ZenReminderMarker>): ZenReminderMarker => ({
    id: "m1",
    user: 1,
    changed: 0,
    date: "2026-08-10",
    income: 0,
    incomeInstrument: 2,
    outcome: 0,
    outcomeInstrument: 2,
    tag: ["food"],
    reminder: "r1",
    state: "planned",
    ...over,
  });

  it("маркер, связанный с фактической операцией, остаётся в плане", () => {
    // Дзен снимает со связанного маркера состояние `planned`; план месяца от
    // этого проваливался — в августе, где связали два плана из трёх, он
    // показывал треть сентябрьского.
    const markers = [
      mk({ id: "a", outcome: 1000, state: "deleted" }),
      mk({ id: "b", outcome: 2000, state: "deleted" }),
      mk({ id: "c", outcome: 3000, date: "2026-08-28" }),
    ];
    const fulfilled = fulfilledMarkerIds([
      { reminderMarker: "a" },
      { reminderMarker: "b" },
      { reminderMarker: null },
    ]);
    const planned = plannedOpsByTagMonth(
      markers, [rub], 2, "2026-08-20", undefined, undefined, fulfilled
    );
    expect(planned.get("food|2026-08")?.outcome).toBe(6000);
  });

  it("отменённый вручную план в сумму не идёт", () => {
    // Тот же снятый маркер, но операции за ним нет: человек убрал вхождение,
    // а не исполнил его.
    const planned = plannedOpsByTagMonth(
      [mk({ id: "a", outcome: 1000, state: "deleted" })],
      [rub], 2, "2026-08-20", undefined, undefined, fulfilledMarkerIds([])
    );
    expect(planned.get("food|2026-08")).toBeUndefined();
  });

  it("просроченный план засчитывается, если он связан", () => {
    // Дата прошла, но за маркером стоит настоящая операция — значит он не
    // «повис», а исполнен.
    const planned = plannedOpsByTagMonth(
      [mk({ id: "a", outcome: 1000, date: "2026-08-01" })],
      [rub], 2, "2026-08-20", undefined, undefined,
      fulfilledMarkerIds([{ reminderMarker: "a" }])
    );
    expect(planned.get("food|2026-08")?.outcome).toBe(1000);
  });

  it("fulfilledMarkerIds: удалённая операция связь не подтверждает", () => {
    const ids = fulfilledMarkerIds([
      { reminderMarker: "a" },
      { reminderMarker: "b", deleted: true },
      { reminderMarker: null },
    ]);
    expect([...ids]).toEqual(["a"]);
  });
});
