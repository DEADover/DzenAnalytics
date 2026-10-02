import { describe, it, expect } from "vitest";
import { diffSortValue, isDiffMode, nextDiffMode } from "./diffMode";

describe("режим столбца разницы", () => {
  it("перебирается по кругу: деньги → проценты → оба → деньги", () => {
    expect(nextDiffMode("money")).toBe("pct");
    expect(nextDiffMode("pct")).toBe("both");
    expect(nextDiffMode("both")).toBe("money");
  });

  it("из хранилища принимается только известный режим", () => {
    expect(isDiffMode("both")).toBe(true);
    expect(isDiffMode("percent")).toBe(false);
    expect(isDiffMode(true)).toBe(false);
  });

  it("сортировка: в процентах — по доле, иначе по деньгам", () => {
    expect(diffSortValue(150, 100, "pct")).toBeCloseTo(0.5);
    expect(diffSortValue(150, 100, "money")).toBe(50);
    expect(diffSortValue(150, 100, "both")).toBe(50);
    // База около нуля: процента нет — строка уходит вниз, а не в «∞».
    expect(diffSortValue(150, 0, "pct")).toBeUndefined();
    expect(diffSortValue(150, -200, "pct")).toBeCloseTo(1.75);
    expect(diffSortValue(150, undefined, "money")).toBeUndefined();
  });
});
