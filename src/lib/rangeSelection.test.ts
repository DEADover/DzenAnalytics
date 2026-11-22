import { describe, expect, it } from "vitest";
import { applyRangeToggle } from "./rangeSelection";

const order = ["a", "b", "c", "d", "e"];
const sorted = (s: Set<string>) => [...s].sort();

describe("applyRangeToggle", () => {
  it("без Shift переключает одну строку", () => {
    expect(sorted(applyRangeToggle(new Set(["a"]), order, "a", "c", false))).toEqual(["a", "c"]);
    expect(sorted(applyRangeToggle(new Set(["a", "c"]), order, "a", "c", false))).toEqual(["a"]);
  });

  it("Shift отмечает всё между точкой отсчёта и строкой, в обе стороны", () => {
    expect(sorted(applyRangeToggle(new Set(["b"]), order, "b", "d", true))).toEqual(["b", "c", "d"]);
    expect(sorted(applyRangeToggle(new Set(["d"]), order, "d", "b", true))).toEqual(["b", "c", "d"]);
  });

  it("Shift по отмеченной строке снимает диапазон, остальное не трогает", () => {
    const out = applyRangeToggle(new Set(["a", "b", "c", "d", "e"]), order, "b", "d", true);
    expect(sorted(out)).toEqual(["a", "e"]);
  });

  it("сохраняет выделение вне диапазона", () => {
    expect(sorted(applyRangeToggle(new Set(["e", "a"]), order, "a", "b", true))).toEqual(["a", "b", "e"]);
  });

  it("без точки отсчёта, при пустом выделении или если её нет в списке — одна строка", () => {
    expect(sorted(applyRangeToggle(new Set(["a"]), order, null, "c", true))).toEqual(["a", "c"]);
    expect(sorted(applyRangeToggle(new Set(), order, "a", "c", true))).toEqual(["c"]);
    expect(sorted(applyRangeToggle(new Set(["x"]), order, "x", "c", true))).toEqual(["c", "x"]);
  });

  it("Shift по самой точке отсчёта переключает только её", () => {
    expect(sorted(applyRangeToggle(new Set(["b", "c"]), order, "b", "b", true))).toEqual(["c"]);
  });

  it("не меняет исходный набор", () => {
    const before = new Set(["a"]);
    applyRangeToggle(before, order, "a", "c", true);
    expect(sorted(before)).toEqual(["a"]);
  });
});
