import { describe, it, expect } from "vitest";
import {
  addInterval,
  buildNewPlan,
  firstOccurrence,
  intervalLabel,
  occurrenceDates,
} from "./planCreate";
import type { ZenTransaction } from "./zenmoney";

describe("addInterval", () => {
  it("месяц держит день, а в коротком месяце берёт последнее число", () => {
    expect(addInterval("2026-01-31", "month", 1)).toBe("2026-02-28");
    expect(addInterval("2026-01-31", "month", 2)).toBe("2026-03-31");
    expect(addInterval("2026-11-15", "month", 3)).toBe("2027-02-15");
  });
  it("неделя и год", () => {
    expect(addInterval("2026-10-15", "week", 2)).toBe("2026-10-29");
    expect(addInterval("2024-02-29", "year", 1)).toBe("2025-02-28");
  });
});

describe("occurrenceDates", () => {
  it("до горизонта или до конца — что раньше", () => {
    expect(occurrenceDates("2026-10-20", "month", 1, null, "2027-01-15")).toEqual([
      "2026-10-20",
      "2026-11-20",
      "2026-12-20",
    ]);
    expect(occurrenceDates("2026-10-20", "month", 1, "2026-11-30", "2027-10-15")).toEqual([
      "2026-10-20",
      "2026-11-20",
    ]);
  });
  it("шаг больше одного", () => {
    expect(occurrenceDates("2026-10-01", "week", 2, null, "2026-11-01")).toEqual([
      "2026-10-01",
      "2026-10-15",
      "2026-10-29",
    ]);
  });
});

describe("firstOccurrence", () => {
  it("следующий повтор после операции, но не в прошлом", () => {
    expect(firstOccurrence("2026-10-05", "month", 1, "2026-10-15")).toBe("2026-11-05");
    expect(firstOccurrence("2026-06-05", "month", 1, "2026-10-15")).toBe("2026-11-05");
    expect(firstOccurrence("2026-10-14", "week", 1, "2026-10-15")).toBe("2026-10-21");
  });
});

const tx = (o: Partial<ZenTransaction>): ZenTransaction =>
  ({
    id: "t1",
    user: 7,
    date: "2026-10-05",
    income: 0,
    outcome: 499,
    incomeInstrument: 2,
    outcomeInstrument: 2,
    incomeAccount: "acc",
    outcomeAccount: "acc",
    tag: ["tag-subs"],
    payee: "Кинопоиск",
    merchant: "m1",
    comment: "старый",
    ...o,
  }) as ZenTransaction;

describe("buildNewPlan", () => {
  let n = 0;
  const uuid = () => `id-${++n}`;

  it("расход: правило как у Дзен-мани и даты на год", () => {
    n = 0;
    const plan = buildNewPlan(
      { tx: tx({}), amount: 599, interval: "month", step: 1, startDate: "2026-11-05", endDate: null, comment: "Подписка" },
      { uuid, today: "2026-10-15", stamp: 100 }
    );
    expect(plan.reminder).toMatchObject({
      id: "id-1",
      user: 7,
      interval: "month",
      step: 1,
      points: [0],
      startDate: "2026-11-05",
      endDate: null,
      outcome: 599,
      income: 0,
      outcomeAccount: "acc",
      tag: ["tag-subs"],
      payee: "Кинопоиск",
      comment: "Подписка",
    });
    expect(plan.markers).toHaveLength(12);
    expect(plan.markers[0]).toMatchObject({ date: "2026-11-05", reminder: "id-1", state: "planned", outcome: 599 });
    expect(plan.markers[11].date).toBe("2027-10-05");
    expect(new Set(plan.markers.map((m) => m.id)).size).toBe(12);
  });

  it("доход и перевод между валютами", () => {
    const income = buildNewPlan(
      { tx: tx({ income: 150_000, outcome: 0 }), amount: 160_000, interval: "month", step: 1, startDate: "2026-11-05", endDate: "2026-12-31", comment: null },
      { uuid, today: "2026-10-15", stamp: 1 }
    );
    expect(income.reminder).toMatchObject({ income: 160_000, outcome: 0 });
    expect(income.markers.map((m) => m.date)).toEqual(["2026-11-05", "2026-12-05"]);

    const fx = buildNewPlan(
      {
        tx: tx({ outcome: 9_000, income: 100, outcomeAccount: "rub", incomeAccount: "usd", incomeInstrument: 1 }),
        amount: 18_000,
        interval: "month",
        step: 1,
        startDate: "2026-11-05",
        endDate: null,
        comment: null,
      },
      { uuid, today: "2026-10-15", stamp: 1 }
    );
    expect(fx.reminder).toMatchObject({ outcome: 18_000, income: 200, incomeAccount: "usd" });
  });
});

describe("intervalLabel", () => {
  it("по-русски с числом", () => {
    expect(intervalLabel("month", 1)).toBe("Каждый месяц");
    expect(intervalLabel("week", 2)).toBe("Каждые 2 недели");
    expect(intervalLabel("month", 5)).toBe("Каждые 5 месяцев");
    expect(intervalLabel("year", 1)).toBe("Каждый год");
  });
});
