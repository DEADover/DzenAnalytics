import { describe, expect, it } from "vitest";
import { forecastMonths } from "./cashflowForecast";

describe("forecastMonths", () => {
  it("прошлый период — прогноза нет", () => {
    expect(forecastMonths({ lastHistYm: "2026-10", periodEndYm: "2025-12", shownMonths: 12 })).toBe(0);
  });

  it("период до последнего месяца истории — до шести месяцев", () => {
    expect(forecastMonths({ lastHistYm: "2026-10", periodEndYm: "2026-10", shownMonths: 12 })).toBe(6);
    expect(forecastMonths({ lastHistYm: "2026-10", periodEndYm: null, shownMonths: 48 })).toBe(6);
  });

  it("короткий период — не больше половины показанной истории", () => {
    expect(forecastMonths({ lastHistYm: "2026-10", periodEndYm: "2026-10", shownMonths: 3 })).toBe(2);
    expect(forecastMonths({ lastHistYm: "2026-10", periodEndYm: "2026-10", shownMonths: 6 })).toBe(3);
    expect(forecastMonths({ lastHistYm: "2026-10", periodEndYm: "2026-10", shownMonths: 1 })).toBe(1);
  });

  it("период, который заканчивается в будущем, — прогноз ровно до его конца, но не дальше шести", () => {
    expect(forecastMonths({ lastHistYm: "2026-10", periodEndYm: "2026-12", shownMonths: 10 })).toBe(2);
    expect(forecastMonths({ lastHistYm: "2026-10", periodEndYm: "2027-02", shownMonths: 3 })).toBe(4);
    expect(forecastMonths({ lastHistYm: "2026-10", periodEndYm: "2027-12", shownMonths: 10 })).toBe(6);
  });

  it("истории нет — прогноза нет", () => {
    expect(forecastMonths({ lastHistYm: null, periodEndYm: null, shownMonths: 0 })).toBe(0);
    expect(forecastMonths({ lastHistYm: "2026-10", periodEndYm: null, shownMonths: 0 })).toBe(0);
  });
});
