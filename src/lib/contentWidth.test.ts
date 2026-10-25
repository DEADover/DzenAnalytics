import { describe, it, expect } from "vitest";
import {
  CONTENT_WIDTH_MAX,
  CONTENT_WIDTH_MIN,
  CONTENT_WIDTH_SLIDER_FULL,
  CONTENT_WIDTH_STEP,
  contentMaxCss,
  contentWidthToSlider,
  formatContentWidth,
  isContentWidth,
  normalizeContentWidth,
  sliderToContentWidth,
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

  it("бегунок: крайнее правое положение — во весь экран (по умолчанию)", () => {
    expect(CONTENT_WIDTH_SLIDER_FULL).toBe(CONTENT_WIDTH_MAX + CONTENT_WIDTH_STEP);
    expect(contentWidthToSlider(0)).toBe(CONTENT_WIDTH_SLIDER_FULL);
    expect(sliderToContentWidth(CONTENT_WIDTH_SLIDER_FULL)).toBe(0);
    expect(sliderToContentWidth(CONTENT_WIDTH_MAX)).toBe(CONTENT_WIDTH_MAX);
    expect(sliderToContentWidth(CONTENT_WIDTH_MIN)).toBe(CONTENT_WIDTH_MIN);
  });

  it("бегунок и ширина переводятся туда и обратно без потерь", () => {
    for (let p = CONTENT_WIDTH_MIN; p <= CONTENT_WIDTH_SLIDER_FULL; p += CONTENT_WIDTH_STEP) {
      expect(contentWidthToSlider(sliderToContentWidth(p))).toBe(p);
    }
    // Ступени по одной на каждое положение: 17 ширин и «Во весь экран».
    expect((CONTENT_WIDTH_SLIDER_FULL - CONTENT_WIDTH_MIN) / CONTENT_WIDTH_STEP + 1).toBe(18);
  });

  it("значение словами", () => {
    expect(formatContentWidth(0)).toBe("Во весь экран");
    expect(formatContentWidth(1920).replace(/\s/g, " ")).toBe("1 920 px");
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
