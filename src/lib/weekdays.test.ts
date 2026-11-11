import { describe, it, expect } from "vitest";
import { WEEKDAYS_BY_JS_DAY, WEEKDAYS_DATIVE_BY_JS_DAY, WEEKDAYS_SHORT_BY_JS_DAY } from "./weekdays";
import { WEEKDAY_SHORT } from "./planSchedule";

describe("дни недели", () => {
  it("по номеру getDay(): 0 — воскресенье", () => {
    expect(WEEKDAYS_SHORT_BY_JS_DAY).toEqual(["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"]);
    expect(WEEKDAYS_BY_JS_DAY[0]).toBe("Воскресенье");
    expect(WEEKDAYS_BY_JS_DAY[new Date(2026, 10, 12).getDay()]).toBe("Четверг");
    expect(WEEKDAYS_DATIVE_BY_JS_DAY[1]).toBe("понедельникам");
  });
  it("строчные сокращения для расписания планов — с понедельника", () => {
    expect(WEEKDAY_SHORT).toEqual(["пн", "вт", "ср", "чт", "пт", "сб", "вс"]);
  });
});
