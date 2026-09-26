import { describe, it, expect } from "vitest";
import {
  computeWhatIfBase,
  avgMonthlyByCategory,
  project,
  eventAmountIn,
  realMonthlyRate,
  autoHorizonYears,
  NEUTRAL_LEVERS,
  DEFAULT_ASSUMPTIONS,
  type ScenarioEvent,
  type WhatIfBase,
} from "./whatif";
import { tx } from "../test/fixtures";

const TODAY = new Date(2026, 9, 15); // 15.10.2026 — сентябрь уже закончен

// День 28: отчётный месяц «2026-08» это 28.08–27.09. Обе операции попадают в
// него, и средние делятся на ОДИН месяц. По календарю это два месяца — и все
// базовые цифры сценария оказываются вдвое меньше.
const txs = [
  tx({ kind: "income", amount: 120000, date: "2026-08-28" }),
  tx({ kind: "expense", amount: 60000, category: "Кафе", date: "2026-09-27" }),
];

describe("computeWhatIfBase — месяц отчётный", () => {
  it("считает средние по отрезку 28.08–27.09", () => {
    const b = computeWhatIfBase(txs, { monthStartDay: 28, today: TODAY });
    expect(b.avgIncome).toBeCloseTo(120000, 5);
    expect(b.avgExpense).toBeCloseTo(60000, 5);
    expect(b.avgSavings).toBeCloseTo(60000, 5);
  });

  it("по умолчанию (день 1) считает по календарным месяцам", () => {
    const b = computeWhatIfBase(txs, { today: TODAY });
    expect(b.avgIncome).toBeCloseTo(60000, 5);
    expect(b.avgExpense).toBeCloseTo(30000, 5);
  });
});

describe("computeWhatIfBase — какие месяцы берём", () => {
  const months = [
    tx({ kind: "income", amount: 100, date: "2026-06-05" }),
    tx({ kind: "income", amount: 100, date: "2026-07-05" }),
    tx({ kind: "income", amount: 1000, date: "2026-08-05" }),
    tx({ kind: "income", amount: 10, date: "2026-09-05" }), // идущий месяц
  ];
  const sept = new Date(2026, 8, 20);

  it("идущий месяц не берёт: в нём ещё не всё", () => {
    const b = computeWhatIfBase(months, { today: sept });
    expect(b.months).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(b.avgIncome).toBeCloseTo(400, 5);
  });

  it("медиана не тянется за разовым всплеском", () => {
    expect(computeWhatIfBase(months, { today: sept, basis: "median" }).avgIncome).toBe(100);
  });

  it("берёт столько последних месяцев, сколько задано", () => {
    expect(computeWhatIfBase(months, { today: sept, months: 1 }).months).toEqual(["2026-08"]);
  });

  it("данные обрываются в середине месяца — этот месяц не берёт", () => {
    // Выгрузка сделана 10 августа: в августе ещё нет зарплаты.
    const cut = [...months.slice(0, 2), tx({ kind: "expense", amount: 50, date: "2026-08-10" })];
    expect(computeWhatIfBase(cut, { today: sept }).months).toEqual(["2026-06", "2026-07"]);
  });

  it("неделя тишины в конце месяца — не обрыв", () => {
    const quiet = [...months.slice(0, 2), tx({ kind: "income", amount: 100, date: "2026-08-26" })];
    expect(computeWhatIfBase(quiet, { today: sept }).months).toEqual(["2026-06", "2026-07", "2026-08"]);
  });

  it("законченных нет — считает по идущему, а не по нулю", () => {
    const only = [tx({ kind: "income", amount: 500, date: "2026-09-05" })];
    expect(computeWhatIfBase(only, { today: sept }).avgIncome).toBe(500);
  });
});

describe("avgMonthlyByCategory — месяц отчётный", () => {
  const spend = [
    tx({ kind: "income", amount: 100000, date: "2026-08-28" }),
    tx({ kind: "expense", amount: 6000, category: "Кафе", date: "2026-09-27" }),
  ];

  it("делит трату на один отчётный месяц, а не на два календарных", () => {
    expect(avgMonthlyByCategory(spend, { monthStartDay: 28, today: TODAY })).toEqual([
      { category: "Кафе", monthly: 6000 },
    ]);
  });

  it("возврат уменьшает расход своей категории", () => {
    const withRefund = [...spend, tx({ kind: "refund", amount: 1000, category: "Кафе", date: "2026-09-27" })];
    expect(avgMonthlyByCategory(withRefund, { monthStartDay: 28, today: TODAY })).toEqual([
      { category: "Кафе", monthly: 5000 },
    ]);
  });

  it("по умолчанию (день 1) месяцев два", () => {
    expect(avgMonthlyByCategory(spend, { today: TODAY })).toEqual([
      { category: "Кафе", monthly: 3000 },
    ]);
  });
});

const BASE: WhatIfBase = {
  avgIncome: 100_000,
  avgExpense: 60_000,
  avgSavings: 40_000,
  savingsRate: 0.4,
  months: [],
  monthly: [],
};
const A0 = { ...DEFAULT_ASSUMPTIONS, horizonYears: 1 };

const ev = (e: Partial<ScenarioEvent>): ScenarioEvent => ({
  id: "e",
  title: "",
  kind: "once",
  sign: "expense",
  amount: 1000,
  start: "2026-10",
  months: null,
  ...e,
});

describe("события", () => {
  it("разовое — только в свой месяц", () => {
    expect(eventAmountIn(ev({}), "2026-09")).toBe(0);
    expect(eventAmountIn(ev({}), "2026-10")).toBe(-1000);
    expect(eventAmountIn(ev({}), "2026-11")).toBe(0);
  });

  it("ежемесячное со сроком — ровно столько месяцев", () => {
    const e = ev({ kind: "monthly", months: 3, sign: "income" });
    expect(["2026-10", "2026-11", "2026-12", "2027-01"].map((m) => eventAmountIn(e, m))).toEqual([
      1000, 1000, 1000, 0,
    ]);
  });

  it("без срока — всегда после начала", () => {
    expect(eventAmountIn(ev({ kind: "monthly" }), "2040-01")).toBe(-1000);
  });
});

describe("project — траектория капитала", () => {
  it("без доходности — капитал плюс двенадцать месяцев сбережений", () => {
    const p = project(BASE, NEUTRAL_LEVERS, [], A0, 100_000, "2026-09");
    expect(p.points).toHaveLength(13);
    expect(p.capitalAtHorizon).toBeCloseTo(100_000 + 40_000 * 12, 5);
  });

  it("«как сейчас» и сценарий без изменений дают один срок до FIRE", () => {
    // Раньше «сейчас» считался с нуля, а сценарий — с капитала, и нетронутый
    // сценарий показывал «сэкономлено 2 года».
    const a = project(BASE, NEUTRAL_LEVERS, [], A0, 5_000_000, "2026-09");
    const b = project(BASE, { ...NEUTRAL_LEVERS }, [], A0, 5_000_000, "2026-09");
    expect(a.yearsToFire).toBe(b.yearsToFire);
    expect(a.fireTarget).toBe(60_000 * 12 * 25);
  });

  it("разовая трата сдвигает капитал в свой месяц", () => {
    const p = project(
      BASE,
      { ...NEUTRAL_LEVERS, events: [ev({ amount: 300_000, start: "2026-11" })] },
      [],
      A0,
      0,
      "2026-09"
    );
    expect(p.points[1].capital).toBe(40_000);
    expect(p.points[2].capital).toBe(80_000 - 300_000);
    expect(p.eventsByYm).toEqual({ "2026-11": -300_000 });
  });

  it("событие текущего месяца попадает в первый шаг, а не пропадает", () => {
    const p = project(
      BASE,
      { ...NEUTRAL_LEVERS, events: [ev({ amount: 100_000, start: "2026-09" })] },
      [],
      A0,
      0,
      "2026-09"
    );
    expect(p.points[1].capital).toBe(40_000 - 100_000);
  });

  it("ежемесячное с текущего месяца — ровно столько месяцев, сколько задано", () => {
    const p = project(
      BASE,
      { ...NEUTRAL_LEVERS, events: [ev({ kind: "monthly", amount: 1_000, start: "2026-09", months: 3 })] },
      [],
      A0,
      0,
      "2026-09"
    );
    // Сентябрь и октябрь — в первом шаге, ноябрь — во втором, дальше ничего.
    expect(p.points[3].capital).toBe(40_000 * 3 - 3_000);
  });

  it("бессрочная трата входит в цель FIRE, срочная — нет", () => {
    const forever = project(BASE, { ...NEUTRAL_LEVERS, events: [ev({ kind: "monthly", amount: 10_000 })] }, [], A0, 0, "2026-09");
    const limited = project(BASE, { ...NEUTRAL_LEVERS, events: [ev({ kind: "monthly", amount: 10_000, months: 12 })] }, [], A0, 0, "2026-09");
    expect(forever.fireTarget).toBe(70_000 * 12 * 25);
    expect(limited.fireTarget).toBe(60_000 * 12 * 25);
  });

  it("категории — до общего множителя расхода", () => {
    const p = project(
      BASE,
      { ...NEUTRAL_LEVERS, categoryMul: { Кафе: 0.5 }, expenseMul: 0.9 },
      [{ category: "Кафе", monthly: 20_000 }],
      A0,
      0,
      "2026-09"
    );
    expect(p.expense).toBeCloseTo((60_000 - 10_000) * 0.9, 5);
  });

  it("капитал уже больше цели — FIRE сейчас", () => {
    const p = project(BASE, NEUTRAL_LEVERS, [], A0, 100_000_000, "2026-09");
    expect(p.yearsToFire).toBe(0);
    expect(p.fireYm).toBe("2026-09");
  });

  it("откладывать нечего — FIRE не наступит", () => {
    const p = project({ ...BASE, avgIncome: 60_000 }, NEUTRAL_LEVERS, [], A0, 0, "2026-09");
    expect(p.fireYm).toBeNull();
    expect(p.yearsToFire).toBe(Infinity);
  });

  it("рост дохода: через год доход выше ровно на заданный процент", () => {
    const A = { ...A0, horizonYears: 2, incomeGrowthPct: 12 };
    const p = project(BASE, NEUTRAL_LEVERS, [], A, 0, "2026-09");
    // Шаг 13 — первый месяц второго года: доход 112 000, траты те же.
    expect(p.points[13].capital - p.points[12].capital).toBeCloseTo(112_000 - 60_000, 5);
    // Траты не растут — цель FIRE та же.
    expect(p.fireTarget).toBe(60_000 * 12 * 25);
  });

  it("минус под доходность не растёт", () => {
    const A = { ...A0, returnPct: 12 };
    const p = project({ ...BASE, avgIncome: 60_000 }, NEUTRAL_LEVERS, [], A, -100_000, "2026-09");
    expect(p.points[12].capital).toBe(-100_000);
  });

  it("доходность равна инфляции — реальный рост ноль", () => {
    expect(realMonthlyRate({ returnPct: 8, inflationPct: 8 })).toBeCloseTo(0, 10);
    expect(Math.pow(1 + realMonthlyRate({ returnPct: 10, inflationPct: 0 }), 12)).toBeCloseTo(1.1, 10);
  });
});

describe("горизонт «До FIRE»", () => {
  it("до самого позднего FIRE и ещё год", () => {
    expect(autoHorizonYears([12.3, 20.1])).toBe(22);
  });
  it("FIRE не наступает ни у кого — 30 лет", () => {
    expect(autoHorizonYears([Infinity, Infinity])).toBe(30);
  });
  it("у одного не наступает — смотрим на тех, у кого наступает", () => {
    expect(autoHorizonYears([Infinity, 40])).toBe(41);
  });
  it("не короче 5 и не длиннее 100 лет", () => {
    expect(autoHorizonYears([0])).toBe(5);
    expect(autoHorizonYears([95])).toBe(96);
    expect(autoHorizonYears([120])).toBe(100);
  });
});
