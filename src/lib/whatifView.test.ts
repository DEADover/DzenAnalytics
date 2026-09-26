import { describe, it, expect } from "vitest";
import { axisTicks } from "./whatifView";
import { shiftPeriod } from "./period";

const months = (from: string, count: number) =>
  Array.from({ length: count + 1 }, (_, i) => shiftPeriod(from, i));

describe("деления оси «Что-если»", () => {
  it("70 лет — январи каждого десятого года, не гуще восьми", () => {
    const a = axisTicks(months("2026-09", 70 * 12));
    expect(a.ticks).toEqual(["2030-01", "2040-01", "2050-01", "2060-01", "2070-01", "2080-01", "2090-01"]);
    expect(a.label("2090-01")).toBe("2090");
  });

  it("10 лет — каждые два года", () => {
    expect(axisTicks(months("2026-09", 120)).ticks).toEqual([
      "2028-01", "2030-01", "2032-01", "2034-01", "2036-01",
    ]);
  });

  it("год — месяцы через один, короткой подписью", () => {
    const a = axisTicks(months("2026-09", 12));
    expect(a.ticks).toEqual(["2026-09", "2026-11", "2027-01", "2027-03", "2027-05", "2027-07", "2027-09"]);
    expect(a.label("2027-01")).toBe("Янв 27");
  });

  it("три года — раз в полгода", () => {
    expect(axisTicks(months("2026-09", 36)).ticks).toHaveLength(6);
  });
});
