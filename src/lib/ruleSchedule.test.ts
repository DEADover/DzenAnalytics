import { describe, it, expect } from "vitest";
import { depthFrom, isDue, withinDepth, type RuleSchedule } from "./ruleSchedule";

const daily: RuleSchedule = { every: "day", depth: "month" };
const monthly: RuleSchedule = { every: "month", depth: "year" };

describe("isDue — пора ли запускать правило", () => {
  it("без расписания не запускается никогда", () => {
    expect(isDue(undefined, undefined, new Date("2026-08-16T10:00:00"))).toBe(false);
  });

  it("ни разу не отрабатывало — пора", () => {
    expect(isDue(daily, undefined, new Date("2026-08-16T10:00:00"))).toBe(true);
  });

  it("«раз в день» считается по календарю, а не по суткам", () => {
    // Запуск в 23:50 не должен отменить утренний: для человека это разные дни.
    expect(isDue(daily, "2026-08-15T23:50:00", new Date("2026-08-16T00:10:00"))).toBe(true);
    expect(isDue(daily, "2026-08-16T00:10:00", new Date("2026-08-16T23:50:00"))).toBe(false);
  });

  it("«раз в месяц» — по календарному месяцу", () => {
    expect(isDue(monthly, "2026-07-31T12:00:00", new Date("2026-08-01T09:00:00"))).toBe(true);
    expect(isDue(monthly, "2026-08-01T09:00:00", new Date("2026-08-31T23:00:00"))).toBe(false);
  });

  it("испорченная отметка времени не блокирует запуск", () => {
    expect(isDue(daily, "не дата", new Date("2026-08-16T10:00:00"))).toBe(true);
  });
});

describe("depthFrom — насколько глубоко смотреть", () => {
  const now = new Date("2026-08-16T12:00:00");

  it("«весь период» — без нижней границы", () => {
    expect(depthFrom("all", now)).toBeNull();
  });

  it("день — сегодняшняя дата", () => {
    expect(depthFrom("day", now)).toBe("2026-08-16");
  });

  it("месяц и год отсчитываются назад от сегодня", () => {
    expect(depthFrom("month", now)).toBe("2026-07-17");
    expect(depthFrom("year", now)).toBe("2025-08-16");
  });
});

describe("withinDepth — попадает ли операция в окно", () => {
  it("без границы попадает всё, даже без даты", () => {
    expect(withinDepth("2019-01-01", null)).toBe(true);
    expect(withinDepth(undefined, null)).toBe(true);
  });

  it("граница включительна", () => {
    expect(withinDepth("2026-07-17", "2026-07-17")).toBe(true);
    expect(withinDepth("2026-07-16", "2026-07-17")).toBe(false);
  });

  it("операция без даты в окно не попадает: сравнивать не с чем", () => {
    expect(withinDepth(undefined, "2026-07-17")).toBe(false);
  });

  it("время в дате не мешает", () => {
    expect(withinDepth("2026-07-20T15:00:00", "2026-07-17")).toBe(true);
  });
});
