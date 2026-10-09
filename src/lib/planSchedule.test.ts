import { describe, expect, it } from "vitest";
import {
  firstAfter,
  sameSchedule,
  scheduleDates,
  scheduleFromReminder,
  scheduleLabel,
  scheduleToReminder,
  weekdayOf,
  type PlanSchedule,
} from "./planSchedule";

const sched = (p: Partial<PlanSchedule>): PlanSchedule => ({
  unit: "month",
  every: 1,
  weekdays: [],
  startDate: "2026-11-10",
  endDate: null,
  ...p,
});

describe("scheduleFromReminder — как хранит Дзен-мани", () => {
  it("неделя — «каждые 7 дней» со сдвигами: пн 07.09 + [0, 3] = пн и чт", () => {
    expect(weekdayOf("2026-09-07")).toBe(0);
    const s = scheduleFromReminder({ interval: "day", step: 7, points: [0, 3], startDate: "2026-09-07", endDate: "2026-12-31" });
    expect(s).toEqual({ unit: "week", every: 1, weekdays: [0, 3], startDate: "2026-09-07", endDate: "2026-12-31" });
    expect(scheduleLabel(s!)).toBe("Каждую неделю, по пн и чт");
  });

  it("«каждые 2 недели» — шаг 14 дней", () => {
    const s = scheduleFromReminder({ interval: "day", step: 14, points: [0], startDate: "2026-11-12", endDate: null })!;
    expect(s).toMatchObject({ unit: "week", every: 2, weekdays: [3] });
    expect(scheduleLabel(s)).toBe("Каждые 2 недели, по чт");
  });

  it("наш прежний «week» тоже читается", () => {
    expect(scheduleFromReminder({ interval: "week", step: 1, points: [0], startDate: "2026-11-13", endDate: null })).toMatchObject({
      unit: "week",
      every: 1,
      weekdays: [4],
    });
  });

  it("месяц, год, дни; разовый — null", () => {
    expect(scheduleFromReminder({ interval: "month", step: 3, points: [0], startDate: "2026-11-10", endDate: null })).toMatchObject({ unit: "month", every: 3 });
    expect(scheduleFromReminder({ interval: "day", step: 3, points: [0], startDate: "2026-11-10", endDate: null })).toMatchObject({ unit: "day", every: 3 });
    expect(scheduleFromReminder({ interval: null, step: 0, points: [0], startDate: "2026-11-10", endDate: "2026-11-10" })).toBeNull();
  });
});

describe("scheduleToReminder — пишем как приложение", () => {
  it("неделя по пн и чт с вторника — начало сдвигается на ближайший выбранный день", () => {
    // 2026-11-10 — вторник; ближайший из пн/чт — четверг 12.11.
    const r = scheduleToReminder(sched({ unit: "week", weekdays: [0, 3] }));
    expect(r).toEqual({ interval: "day", step: 7, points: [0, 4], startDate: "2026-11-12", endDate: null });
  });

  it("туда и обратно — то же расписание", () => {
    const s = sched({ unit: "week", every: 2, weekdays: [1, 4], startDate: "2026-11-10" });
    const back = scheduleFromReminder(scheduleToReminder(s))!;
    expect(back.weekdays).toEqual([1, 4]);
    expect(back.every).toBe(2);
    expect(sameSchedule(s, back)).toBe(true);
  });

  it("месяц — как есть", () => {
    expect(scheduleToReminder(sched({ every: 2 }))).toEqual({ interval: "month", step: 2, points: [0], startDate: "2026-11-10", endDate: null });
  });
});

describe("scheduleDates", () => {
  it("месяц: день сохраняется, в коротком месяце — последнее число", () => {
    expect(scheduleDates(sched({ startDate: "2027-01-31" }), "2027-01-01", "2027-04-30")).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
    ]);
  });

  it("неделя по пн и чт: обе даты каждую неделю", () => {
    expect(scheduleDates(sched({ unit: "week", weekdays: [0, 3], startDate: "2026-11-09" }), "2026-11-01", "2026-11-22")).toEqual([
      "2026-11-09",
      "2026-11-12",
      "2026-11-16",
      "2026-11-19",
    ]);
  });

  it("с `from` — прошедшие не строятся; конец расписания ограничивает", () => {
    const s = sched({ unit: "week", every: 2, weekdays: [3], startDate: "2026-09-03", endDate: "2026-11-30" });
    expect(scheduleDates(s, "2026-10-14", "2027-10-15")).toEqual(["2026-10-15", "2026-10-29", "2026-11-12", "2026-11-26"]);
  });

  it("каждые 3 дня", () => {
    expect(scheduleDates(sched({ unit: "day", every: 3, startDate: "2026-11-01" }), "2026-11-01", "2026-11-10")).toEqual([
      "2026-11-01",
      "2026-11-04",
      "2026-11-07",
      "2026-11-10",
    ]);
  });
});

describe("scheduleLabel", () => {
  it("склонения", () => {
    expect(scheduleLabel(sched({}))).toBe("Каждый месяц");
    expect(scheduleLabel(sched({ every: 3 }))).toBe("Каждые 3 месяца");
    expect(scheduleLabel(sched({ unit: "year", every: 5 }))).toBe("Каждые 5 лет");
    expect(scheduleLabel(sched({ unit: "day", every: 1 }))).toBe("Каждый день");
    expect(scheduleLabel(sched({ unit: "week", every: 1, weekdays: [0, 2, 4] }))).toBe("Каждую неделю, по пн, ср и пт");
  });
});

describe("firstAfter — первый повтор после операции", () => {
  it("следующий повтор после операции, но не в прошлом", () => {
    expect(firstAfter("2026-10-05", sched({}), "2026-10-15")).toBe("2026-11-05");
    expect(firstAfter("2026-06-05", sched({}), "2026-10-15")).toBe("2026-11-05");
    expect(firstAfter("2026-10-14", sched({ unit: "week", weekdays: [] }), "2026-10-15")).toBe("2026-10-21");
  });
});
