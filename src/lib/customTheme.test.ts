import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CUSTOM_COLOR_TOKENS,
  contrastRatio,
  customThemeCss,
  customThemeVars,
  formatContrast,
  hexToRgb,
  hexToTriplet,
  normalizeHex,
  parseCustomTheme,
  relativeLuminance,
  sameCustomTheme,
  tripletToHex,
  type CustomColors,
} from "./customTheme";
import { isDarkChoice, isLightChoice, schemeName } from "./themeSchemes";

const FROST: CustomColors = {
  bg: "#f8fafc",
  panel: "#ffffff",
  panel2: "#f1f5f9",
  border: "#e2e8f0",
  muted: "#64748b",
  text: "#0f172a",
  accent: "#0891b2",
  accentFg: "#ffffff",
  accent2: "#7c3aed",
  income: "#16a34a",
  expense: "#dc2626",
  warn: "#d97706",
  onTone: "#ffffff",
};

describe("своя тема: цвета", () => {
  it("hex разбирается в любом привычном виде", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("abc")).toBe("#aabbcc");
    expect(normalizeHex(" #1E88E5 ")).toBe("#1e88e5");
    expect(normalizeHex("1e88e5")).toBe("#1e88e5");
    expect(normalizeHex("#1e88e")).toBeNull();
    expect(normalizeHex("#ggg")).toBeNull();
    expect(normalizeHex("")).toBeNull();
    expect(hexToRgb("#0891b2")).toEqual([8, 145, 178]);
    expect(hexToRgb("nope")).toBeNull();
  });

  it("токен «R G B» ↔ hex", () => {
    expect(tripletToHex("8 145 178")).toBe("#0891b2");
    expect(tripletToHex(" 255 255 255 ")).toBe("#ffffff");
    expect(tripletToHex("1 2")).toBeNull();
    expect(tripletToHex("300 0 0")).toBeNull();
    expect(hexToTriplet("#0891b2")).toBe("8 145 178");
  });

  it("контраст по WCAG", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#000000")).toBe(0);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
    // Известная пара: #767676 на белом — ровно на границе AA.
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
    // У «Инея» текст на фоне читается, белое на акценте — нет.
    expect(contrastRatio(FROST.text, FROST.bg)).toBeGreaterThan(4.5);
    expect(contrastRatio(FROST.accentFg, FROST.accent)).toBeLessThan(4.5);
    // Округление вниз: 4,49 не должно показываться как «4,5».
    expect(formatContrast(4.49)).toBe("4,4:1");
    expect(formatContrast(21)).toBe("21:1");
    expect(formatContrast(3)).toBe("3:1");
  });
});

describe("своя тема: токены", () => {
  it("производные выводятся из основных и вида", () => {
    const light = customThemeVars("light", FROST);
    expect(light["--c-accent"]).toBe("8 145 178");
    expect(light["--grid"]).toBe(FROST.border);
    expect(light["--tooltip-bg"]).toBe(FROST.panel);
    expect(light["--tooltip-border"]).toBe(FROST.border);
    expect(light["--shadow-tray"]).toContain("rgba(15, 23, 42");
    expect(customThemeVars("dark", FROST)["--shadow-tray"]).toContain("rgba(0, 0, 0, 0.7)");
  });

  it("блок CSS полный — тот же набор, что у готовых тем в index.css", () => {
    const css = customThemeCss("dark", FROST);
    expect(css.startsWith('[data-scheme="custom-dark"] {')).toBe(true);
    // Набор токенов сверяем с готовой темой: появится новый — тест скажет.
    const index = readFileSync(resolve(__dirname, "../index.css"), "utf8");
    const frost = index.match(/\[data-scheme="frost"\]\s*\{([^}]*)\}/)![1];
    const tokens = [...frost.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]);
    for (const t of tokens) expect(css, `нет ${t}`).toMatch(new RegExp(`${t}:`));
    // И основные цвета — ровно те, что у готовой темы в формате «R G B».
    for (const t of CUSTOM_COLOR_TOKENS) expect(tokens).toContain(t.token);
  });

  it("разбор сохранённого: строка JSON или объект, неполное — null", () => {
    const theme = { base: "frost", colors: FROST };
    expect(parseCustomTheme(JSON.stringify(theme))).toEqual(theme);
    expect(parseCustomTheme({ base: "frost", colors: { ...FROST, accent: "#ABC" } })?.colors.accent).toBe("#aabbcc");
    const { accent: _drop, ...partial } = FROST;
    void _drop;
    expect(parseCustomTheme({ base: "frost", colors: partial })).toBeNull();
    expect(parseCustomTheme({ base: "frost", colors: { ...FROST, text: "red" } })).toBeNull();
    expect(parseCustomTheme({ colors: FROST })).toBeNull();
    expect(parseCustomTheme("{oops")).toBeNull();
    expect(parseCustomTheme(null)).toBeNull();
  });

  it("сравнение тем", () => {
    const a = { base: "frost", colors: FROST };
    expect(sameCustomTheme(a, { base: "frost", colors: { ...FROST } })).toBe(true);
    expect(sameCustomTheme(a, { base: "frost", colors: { ...FROST, bg: "#000000" } })).toBe(false);
    expect(sameCustomTheme(a, null)).toBe(false);
    expect(sameCustomTheme(null, null)).toBe(true);
  });

  it("выбор вида принимает свою тему только своего вида", () => {
    expect(isLightChoice("custom-light")).toBe(true);
    expect(isLightChoice("custom-dark")).toBe(false);
    expect(isDarkChoice("custom-dark")).toBe(true);
    expect(isDarkChoice("frost")).toBe(false);
    expect(schemeName("custom-dark")).toBe("Своя");
    expect(schemeName("paper")).toBe("Бумага");
  });
});
