import { describe, it, expect } from "vitest";
import {
  CONTENT_WIDTH_DEFAULT,
  CONTENT_WIDTH_MAX,
  CONTENT_WIDTH_MIN,
  CONTENT_WIDTH_STEP,
  contentMaxCss,
  isContentWidth,
  normalizeContentWidth,
} from "./contentWidth";

describe("ширина сервиса", () => {
  it("по умолчанию и из мусора — во весь экран", () => {
    for (const v of [undefined, null, "1600", NaN, Infinity, -100, 0, {}, true]) {
      expect(normalizeContentWidth(v)).toBe(0);
    }
  });

  it("число прижимается к краям бегунка", () => {
    expect(normalizeContentWidth(800)).toBe(CONTENT_WIDTH_MIN);
    expect(normalizeContentWidth(5120)).toBe(CONTENT_WIDTH_MAX);
  });

  it("встаёт на шаг бегунка", () => {
    expect(normalizeContentWidth(1600)).toBe(1600);
    expect(normalizeContentWidth(1630)).toBe(1600);
    expect(normalizeContentWidth(1650)).toBe(1680);
    for (let w = CONTENT_WIDTH_MIN; w <= CONTENT_WIDTH_MAX; w += CONTENT_WIDTH_STEP) {
      expect(normalizeContentWidth(w)).toBe(w);
    }
  });

  it("начальная ширина — одна из ступеней", () => {
    expect(isContentWidth(CONTENT_WIDTH_DEFAULT)).toBe(true);
  });

  it("с другого устройства принимается только готовое значение", () => {
    expect(isContentWidth(0)).toBe(true);
    expect(isContentWidth(1920)).toBe(true);
    expect(isContentWidth(1930)).toBe(false);
    expect(isContentWidth(9999)).toBe(false);
    expect(isContentWidth(-1)).toBe(false);
    expect(isContentWidth("1920")).toBe(false);
    expect(isContentWidth(null)).toBe(false);
  });

  it("CSS: во весь экран — 100%, иначе пиксели", () => {
    expect(contentMaxCss(0)).toBe("100%");
    expect(contentMaxCss(1600)).toBe("1600px");
  });
});
