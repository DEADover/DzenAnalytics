import { describe, it, expect } from "vitest";
import { rangeChange } from "./rangeCompare";

const pts = [
  { date: "2026-09-07", net: 30_900 },
  { date: "2026-09-15", net: 20_250 },
  { date: "2026-09-20", net: 23_250 },
];
const net = (p: { net: number }) => p.net;

describe("rangeChange", () => {
  it("изменение в деньгах и процентах от начала", () => {
    const r = rangeChange(pts, "2026-09-07", "2026-09-20", net)!;
    expect(r.delta).toBe(-7650);
    expect(r.pct).toBeCloseTo(-0.2476, 4);
    expect(r.days).toBe(13);
  });

  it("порядок точек не важен — тянуть можно справа налево", () => {
    expect(rangeChange(pts, "2026-09-20", "2026-09-07", net)).toEqual(
      rangeChange(pts, "2026-09-07", "2026-09-20", net)
    );
  });

  it("одна и та же точка или дата вне графика — сравнивать нечего", () => {
    expect(rangeChange(pts, "2026-09-07", "2026-09-07", net)).toBeNull();
    expect(rangeChange(pts, "2026-09-07", "2026-10-01", net)).toBeNull();
  });

  it("от нуля или от минуса процента нет", () => {
    const debt = [
      { date: "2026-01-01", net: -1000 },
      { date: "2026-02-01", net: 500 },
    ];
    const r = rangeChange(debt, "2026-01-01", "2026-02-01", net)!;
    expect(r.delta).toBe(1500);
    expect(r.pct).toBeNull();
  });
});
