import { describe, it, expect } from "vitest";
import { capitalPeriodStart, capitalSlice, capitalSummary, clipBalances, thinCapital } from "./capital";

const pts = (rows: [string, number][]) => rows.map(([date, net]) => ({ date, net }));

describe("capitalPeriodStart", () => {
  it("минус N месяцев от сегодня", () => {
    expect(capitalPeriodStart("3m", "2026-10-01")).toBe("2026-07-01");
    expect(capitalPeriodStart("1y", "2026-10-01")).toBe("2025-10-01");
  });
  it("«Всё время» — без начала", () => {
    expect(capitalPeriodStart("all", "2026-10-01")).toBeNull();
  });
});

describe("capitalSlice", () => {
  const series = pts([
    ["2026-05-10", 100],
    ["2026-06-20", 150],
    ["2026-07-15", 170],
    ["2026-09-01", 200],
  ]);

  it("первая точка — остаток на начало периода", () => {
    expect(capitalSlice(series, "2026-07-01")).toEqual(
      pts([
        ["2026-07-01", 150],
        ["2026-07-15", 170],
        ["2026-09-01", 200],
      ])
    );
  });

  it("операция в первый день периода — без лишней точки", () => {
    expect(capitalSlice(series, "2026-06-20")[0]).toEqual({ date: "2026-06-20", net: 150 });
    expect(capitalSlice(series, "2026-06-20")).toHaveLength(3);
  });

  it("до начала истории — только то, что есть", () => {
    expect(capitalSlice(series, "2020-01-01")).toEqual(series);
  });

  it("без начала — вся кривая", () => {
    expect(capitalSlice(series, null)).toBe(series);
  });
});

describe("clipBalances", () => {
  const series = pts([
    ["2026-08-10", 100],
    ["2026-09-20", 150],
  ]);

  it("в периоде без операций — ровная линия на последнем остатке до сегодня", () => {
    expect(clipBalances(series, "2026-10-01", "2026-10-31", "2026-10-01")).toEqual(
      pts([["2026-10-01", 150]])
    );
    expect(clipBalances(series, "2026-10-01", "2026-10-31", "2026-10-15")).toEqual(
      pts([
        ["2026-10-01", 150],
        ["2026-10-15", 150],
      ])
    );
  });

  it("прошлый период без операций — до его конца", () => {
    expect(clipBalances(pts([["2026-01-05", 10], ["2026-05-01", 20]]), "2026-03-01", "2026-03-31", "2026-10-01")).toEqual(
      pts([
        ["2026-03-01", 10],
        ["2026-03-31", 10],
      ])
    );
  });

  it("период раньше начала истории — пусто", () => {
    expect(clipBalances(series, "2025-01-01", "2025-01-31", "2026-10-01")).toEqual([]);
  });

  it("переносит точку целиком — с остатками отдельных счетов", () => {
    const s = [{ date: "2026-09-20", total: 150, a: 100, b: 50 }];
    expect(clipBalances(s, "2026-10-01", "2026-10-31", "2026-10-01")).toEqual([
      { date: "2026-10-01", total: 150, a: 100, b: 50 },
    ]);
  });
});

describe("capitalSummary", () => {
  it("изменение, процент, крайние точки и прирост в месяц", () => {
    const s = capitalSummary(
      pts([
        ["2026-01-01", 1000],
        ["2026-03-01", 800],
        ["2026-05-01", 1500],
        ["2026-07-01", 1300],
      ])
    )!;
    expect(s.current).toBe(1300);
    expect(s.delta).toBe(300);
    expect(s.pct).toBeCloseTo(30);
    expect(s.max).toEqual({ date: "2026-05-01", net: 1500 });
    expect(s.min).toEqual({ date: "2026-03-01", net: 800 });
    expect(s.perMonth).toBeCloseTo(300 / (181 / 30.44), 5);
  });

  it("процент от нуля или долга не считается", () => {
    expect(capitalSummary(pts([["2026-01-01", 0], ["2026-03-01", 100]]))!.pct).toBeNull();
    expect(capitalSummary(pts([["2026-01-01", -50], ["2026-03-01", 100]]))!.pct).toBeNull();
  });

  it("отрезок короче месяца — без прироста в месяц", () => {
    expect(capitalSummary(pts([["2026-01-01", 1], ["2026-01-20", 2]]))!.perMonth).toBeNull();
  });

  it("пусто — нет сводки", () => {
    expect(capitalSummary([])).toBeNull();
  });
});

describe("thinCapital", () => {
  it("короткую кривую не трогает", () => {
    const s = pts([["2026-01-01", 1], ["2026-01-02", 2]]);
    expect(thinCapital(s, 10)).toBe(s);
  });

  it("длинную прореживает, первая и последняя на месте", () => {
    const s = Array.from({ length: 1000 }, (_, i) => ({ date: `d${i}`, net: i }));
    const t = thinCapital(s, 100);
    expect(t.length).toBeLessThanOrEqual(101);
    expect(t[0]).toBe(s[0]);
    expect(t[t.length - 1]).toBe(s[999]);
  });
});
