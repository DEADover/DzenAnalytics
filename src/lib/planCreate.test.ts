import { describe, it, expect } from "vitest";
import { buildNewPlan } from "./planCreate";
import type { PlanSchedule } from "./planSchedule";
import type { ZenTransaction } from "./zenmoney";

const monthly = (startDate: string, endDate: string | null = null): PlanSchedule => ({
  unit: "month",
  every: 1,
  weekdays: [],
  startDate,
  endDate,
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
      { tx: tx({}), amount: 599, schedule: monthly("2026-11-05"), comment: "Подписка" },
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
      { tx: tx({ income: 150_000, outcome: 0 }), amount: 160_000, schedule: monthly("2026-11-05", "2026-12-31"), comment: null },
      { uuid, today: "2026-10-15", stamp: 1 }
    );
    expect(income.reminder).toMatchObject({ income: 160_000, outcome: 0 });
    expect(income.markers.map((m) => m.date)).toEqual(["2026-11-05", "2026-12-05"]);

    const fx = buildNewPlan(
      {
        tx: tx({ outcome: 9_000, income: 100, outcomeAccount: "rub", incomeAccount: "usd", incomeInstrument: 1 }),
        amount: 18_000,
        schedule: monthly("2026-11-05"),
        comment: null,
      },
      { uuid, today: "2026-10-15", stamp: 1 }
    );
    expect(fx.reminder).toMatchObject({ outcome: 18_000, income: 200, incomeAccount: "usd" });
  });
});

it("неделя пишется как в самом приложении: «каждые 7 дней» с днями недели", () => {
  const plan = buildNewPlan(
    {
      tx: tx({}),
      amount: 100,
      schedule: { unit: "week", every: 1, weekdays: [0, 3], startDate: "2026-11-09", endDate: "2026-11-22" },
      comment: null,
    },
    { uuid: () => "x" + Math.random(), today: "2026-10-15", stamp: 1 }
  );
  expect(plan.reminder).toMatchObject({ interval: "day", step: 7, points: [0, 3], startDate: "2026-11-09" });
  expect(plan.markers.map((m) => m.date)).toEqual(["2026-11-09", "2026-11-12", "2026-11-16", "2026-11-19"]);
});
