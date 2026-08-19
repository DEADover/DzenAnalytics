import { describe, it, expect } from "vitest";
import {
  monthProgress,
  paceRatio,
  projectExpense,
  upcomingPayments,
  upcomingTotal,
  freeMoney,
  monthEnd,
  heatStep,
  robustCeiling,
} from "./dashboardModel";
import type { RecurringCandidate } from "./aggregations";
import type { CurrencyRates } from "../types";

const RATES: CurrencyRates = { base: "RUB", rates: { RUB: 1, USD: 80, EUR: 90 } };

function rec(over: Partial<RecurringCandidate>): RecurringCandidate {
  return {
    payee: "Подписка",
    category: "Развлечения",
    avgAmount: 500,
    currency: "RUB",
    occurrences: 6,
    avgIntervalDays: 30,
    monthsCovered: 6,
    consistency: 0.9,
    lastDate: "2026-07-22",
    nextExpected: "2026-08-22",
    daysSinceLast: 27,
    stale: false,
    totalSpent: 3000,
    txIds: [],
    ...over,
  } as RecurringCandidate;
}

describe("monthProgress — насколько месяц прожит", () => {
  it("середина месяца: 18 из 31", () => {
    const p = monthProgress("2026-08", new Date(2026, 7, 18, 12));
    expect(p.day).toBe(18);
    expect(p.days).toBe(31);
    expect(p.left).toBe(13);
    expect(p.running).toBe(true);
    expect(p.progress).toBeCloseTo(18 / 31, 5);
  });

  it("завершённый месяц прожит целиком и больше не «идёт»", () => {
    const p = monthProgress("2026-07", new Date(2026, 7, 18));
    expect(p).toMatchObject({ day: 31, days: 31, progress: 1, left: 0, running: false });
  });

  it("февраль високосного года — 29 дней", () => {
    expect(monthProgress("2028-02", new Date(2028, 1, 10)).days).toBe(29);
  });

  it("будущий месяц: ноль прожитых дней, а не отрицательные", () => {
    const p = monthProgress("2026-12", new Date(2026, 7, 18));
    expect(p.day).toBe(0);
    expect(p.progress).toBe(0);
    expect(p.left).toBe(31);
  });
});

describe("paceRatio — темп против обычного", () => {
  it("КЛЮЧЕВОЕ: сравнивает прожитую долю, а не полный месяц с полным", () => {
    // 18 из 31 дня прожито, обычный месяц — 100 000. Ожидаем к сегодня ~58 065.
    // Потрачено 65 000 → идём быстрее примерно на 12 %.
    const r = paceRatio(65_000, 18 / 31, 100_000);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(65_000 / (100_000 * (18 / 31)), 5);
    expect(r!).toBeGreaterThan(1.1);
    expect(r!).toBeLessThan(1.15);
  });

  it("ровно по обычному темпу — единица", () => {
    expect(paceRatio(50_000, 0.5, 100_000)).toBeCloseTo(1, 5);
  });

  it("не с чем сравнивать — null, а не ноль и не бесконечность", () => {
    expect(paceRatio(65_000, 18 / 31, 0)).toBeNull();
    expect(paceRatio(65_000, 0, 100_000)).toBeNull();
  });
});

describe("projectExpense — куда придём к концу месяца", () => {
  it("линейно продлевает текущий темп", () => {
    expect(projectExpense(50_000, 0.5)).toBeCloseTo(100_000, 5);
  });

  it("месяц не начался — прогнозировать не из чего", () => {
    expect(projectExpense(0, 0)).toBe(0);
  });
});

describe("upcomingPayments — что спишется до конца месяца", () => {
  it("КЛЮЧЕВОЕ: валютный платёж пересчитывается в базовую для итога", () => {
    // Ровно тот баг, что был на главной: 9 $ попадали в рублёвый итог как 9 ₽.
    const list = upcomingPayments(
      [rec({ payee: "Kling", avgAmount: 9, currency: "USD", nextExpected: "2026-08-22" })],
      RATES,
      "2026-08-18",
      "2026-08-31"
    );
    expect(list).toHaveLength(1);
    expect(list[0].amount).toBe(9);
    expect(list[0].currency).toBe("USD");
    expect(list[0].amountBase).toBe(720);
    expect(upcomingTotal(list)).toBe(720);
  });

  it("складывает разные валюты через базовую", () => {
    const list = upcomingPayments(
      [
        rec({ payee: "Связь", avgAmount: 500, currency: "RUB", nextExpected: "2026-08-20" }),
        rec({ payee: "Kling", avgAmount: 9, currency: "USD", nextExpected: "2026-08-22" }),
      ],
      RATES,
      "2026-08-18",
      "2026-08-31"
    );
    expect(upcomingTotal(list)).toBe(500 + 720);
  });

  it("заброшенные подписки не ждут: stale отбрасывается", () => {
    const list = upcomingPayments(
      [rec({ stale: true, nextExpected: "2026-08-20" })],
      RATES,
      "2026-08-18",
      "2026-08-31"
    );
    expect(list).toEqual([]);
  });

  it("платёж за границей окна не берётся", () => {
    const list = upcomingPayments(
      [
        rec({ payee: "Уже прошёл", nextExpected: "2026-08-17" }),
        rec({ payee: "В сентябре", nextExpected: "2026-09-02" }),
      ],
      RATES,
      "2026-08-18",
      "2026-08-31"
    );
    expect(list).toEqual([]);
  });

  it("считает, через сколько дней, и сортирует по дате", () => {
    const list = upcomingPayments(
      [
        rec({ payee: "Поздний", nextExpected: "2026-08-28" }),
        rec({ payee: "Сегодня", nextExpected: "2026-08-18" }),
      ],
      RATES,
      "2026-08-18",
      "2026-08-31"
    );
    expect(list.map((p) => p.payee)).toEqual(["Сегодня", "Поздний"]);
    expect(list[0].inDays).toBe(0);
    expect(list[1].inDays).toBe(10);
  });
});

describe("freeMoney — сколько остаётся до конца месяца", () => {
  it("КЛЮЧЕВОЕ: считает по факту и ничего не подставляет вместо него", () => {
    // Раньше сюда приходил «прогноз дохода» — среднее за прошлые месяцы, — и
    // на главной стояло 543 800 там, где месяц принёс 158 994.
    const f = freeMoney({ factIncome: 158_994, factExpense: 198_297, aheadObligatory: 7_400 });
    expect(f.value).toBe(158_994 - 198_297 - 7_400);
    expect(f).toMatchObject({ income: 158_994, spent: 198_297, ahead: 7_400 });
  });

  it("нехватка показывается отрицательной, а не нулём", () => {
    expect(freeMoney({ factIncome: 100_000, factExpense: 130_000, aheadObligatory: 5_000 }).value)
      .toBe(-35_000);
  });

  it("слагаемые возвращаются как есть — по ним можно сверить итог", () => {
    const f = freeMoney({ factIncome: 300_000, factExpense: 120_000, aheadObligatory: 20_000 });
    expect(f.income - f.spent - f.ahead).toBe(f.value);
  });
});

describe("monthEnd", () => {
  it("последний день месяца", () => {
    expect(monthEnd("2026-08")).toBe("2026-08-31");
    expect(monthEnd("2026-02")).toBe("2026-02-28");
    expect(monthEnd("2028-02")).toBe("2028-02-29");
  });
});

describe("heatStep — ступень тепловой шкалы", () => {
  it("КЛЮЧЕВОЕ: день без трат — отдельная ступень, а не бледный оттенок", () => {
    expect(heatStep(0, 10_000)).toBe(0);
    expect(heatStep(1, 10_000)).toBe(1);
  });

  it("максимум попадает в верхнюю ступень", () => {
    expect(heatStep(10_000, 10_000)).toBe(4);
  });

  it("делит диапазон на равные доли", () => {
    expect(heatStep(2_500, 10_000)).toBe(1);
    expect(heatStep(5_000, 10_000)).toBe(2);
    expect(heatStep(7_500, 10_000)).toBe(3);
  });
});

describe("robustCeiling — шкала, устойчивая к выбросам", () => {
  it("КЛЮЧЕВОЕ: один рекордный месяц не задирает шкалу", () => {
    // Обычные месяцы 200–600 тыс. и одна покупка на 2,4 млн: без среза
    // типичный столбец занимал бы пятую часть высоты.
    const vals = [230, 250, 270, 280, 330, 330, 380, 430, 560, 800, 1250, 2400];
    const { cap, clipped } = robustCeiling(vals);
    expect(clipped).toBe(true);
    expect(cap).toBeLessThan(2400);
    expect(cap).toBeGreaterThan(600);
  });

  it("ровный ряд не режется вовсе", () => {
    const vals = [200, 210, 220, 230, 240, 250];
    const { cap, clipped } = robustCeiling(vals);
    expect(clipped).toBe(false);
    expect(cap).toBe(250);
  });

  it("превышение на несколько процентов не повод резать шкалу", () => {
    const vals = [100, 100, 100, 100, 100, 104];
    expect(robustCeiling(vals).clipped).toBe(false);
  });

  it("на коротком ряду не режем: три точки — это не распределение", () => {
    expect(robustCeiling([100, 200, 5000])).toEqual({ cap: 5000, clipped: false });
  });

  it("нули и мусор игнорируются, пустой ряд даёт ноль", () => {
    expect(robustCeiling([])).toEqual({ cap: 0, clipped: false });
    expect(robustCeiling([0, 0, Number.NaN])).toEqual({ cap: 0, clipped: false });
  });
});
