import { describe, expect, it } from "vitest";
import { DEFAULT_QUICK_SETTINGS, isDefaultQuickSettings, normalizeQuickSettings } from "./quickSettings";

describe("быстрые настройки — сохранённый набор", () => {
  it("не массив — набор по умолчанию", () => {
    expect(normalizeQuickSettings(null)).toEqual([...DEFAULT_QUICK_SETTINGS]);
    expect(normalizeQuickSettings({ a: 1 })).toEqual([...DEFAULT_QUICK_SETTINGS]);
  });
  it("пустой массив — осознанно пустая панель", () => {
    expect(normalizeQuickSettings([])).toEqual([]);
  });
  it("незнакомое и повторы отсекаются, порядок сохраняется", () => {
    expect(normalizeQuickSettings(["kopecks", "theme", 5, "hideAmounts", "kopecks"])).toEqual([
      "kopecks",
      "hideAmounts",
    ]);
  });
  it("набор по умолчанию узнаётся", () => {
    expect(isDefaultQuickSettings([...DEFAULT_QUICK_SETTINGS])).toBe(true);
    expect(isDefaultQuickSettings(["hideAmounts"])).toBe(false);
  });
});
