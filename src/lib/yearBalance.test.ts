import { describe, it, expect } from "vitest";
import { yearBalance } from "./yearBalance";

const series = [
  { date: "2025-11-10", net: 100 },
  { date: "2025-12-20", net: 300 },
  { date: "2026-02-01", net: 250 },
  { date: "2026-06-15", net: 900 },
  { date: "2026-09-03", net: 120 },
  { date: "2026-12-30", net: 400 },
  { date: "2027-01-05", net: 50 },
];

describe("yearBalance", () => {
  it("прошедший год: начало — остаток до года, конец — последняя точка года", () => {
    const b = yearBalance(series, "2026-01-01", "2026-12-31", "2027-03-01")!;
    expect(b.start).toEqual({ date: "2026-01-01", value: 300, fromHistoryStart: false });
    expect(b.end).toEqual({ date: "2026-12-31", value: 400 });
    expect(b.max).toEqual({ date: "2026-06-15", value: 900 });
    expect(b.min).toEqual({ date: "2026-09-03", value: 120 });
  });

  it("идущий год: конец — на сегодня, будущее не считается", () => {
    const b = yearBalance(series, "2026-01-01", "2026-12-31", "2026-07-01")!;
    expect(b.end).toEqual({ date: "2026-07-01", value: 900 });
    expect(b.min).toEqual({ date: "2026-02-01", value: 250 });
  });

  it("история началась внутри года — отсчёт от первой точки", () => {
    const b = yearBalance(series, "2025-01-01", "2025-12-31", "2027-03-01")!;
    expect(b.start).toEqual({ date: "2025-11-10", value: 100, fromHistoryStart: true });
    expect(b.end.value).toBe(300);
    expect(b.max.value).toBe(300);
    expect(b.min).toEqual({ date: "2025-11-10", value: 100 });
  });

  it("остаток на начало года — тоже кандидат в максимум и минимум", () => {
    const b = yearBalance(
      [
        { date: "2025-12-01", net: 1000 },
        { date: "2026-03-01", net: 500 },
      ],
      "2026-01-01",
      "2026-12-31",
      "2027-01-01"
    )!;
    expect(b.max).toEqual({ date: "2026-01-01", value: 1000 });
    expect(b.min).toEqual({ date: "2026-03-01", value: 500 });
  });

  it("год без движений держит прежний остаток", () => {
    const b = yearBalance([{ date: "2024-05-01", net: 70 }], "2026-01-01", "2026-12-31", "2027-01-01")!;
    expect(b.start.value).toBe(70);
    expect(b.end.value).toBe(70);
  });

  it("нет точек до конца года или год ещё не начался — null", () => {
    expect(yearBalance(series, "2024-01-01", "2024-12-31", "2027-01-01")).toBeNull();
    expect(yearBalance(series, "2028-01-01", "2028-12-31", "2027-03-01")).toBeNull();
    expect(yearBalance([], "2026-01-01", "2026-12-31", "2026-07-01")).toBeNull();
  });
});
