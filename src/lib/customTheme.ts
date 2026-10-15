/**
 * Своя тема: по одной на светлый и тёмный вид, цвета — на вкус человека.
 *
 * Своя тема начинается копией готовой (её цвета читаются из `index.css` теми
 * же токенами) и хранится набором hex-цветов в `localStorage`. На экран она
 * попадает `<style>`-блоком `[data-scheme="custom-light"]` / `custom-dark` —
 * так же, как готовые темы из `index.css`. Поэтому и плитка «Своя» в окне
 * темы рисуется своими цветами: ей хватает пометки `data-scheme`.
 *
 * Редактируются только тринадцать цветов-ролей. Сетка графиков, подсказки и
 * тень выводятся из них: сетка и кант подсказки — цвет границ, фон подсказки —
 * цвет карточек, тень — по виду темы.
 */

import type { ThemeKind } from "./themeSchemes";

export const CUSTOM_LIGHT_ID = "custom-light";
export const CUSTOM_DARK_ID = "custom-dark";
export type CustomSchemeId = typeof CUSTOM_LIGHT_ID | typeof CUSTOM_DARK_ID;

export function customSchemeId(kind: ThemeKind): CustomSchemeId {
  return kind === "dark" ? CUSTOM_DARK_ID : CUSTOM_LIGHT_ID;
}

/** Цвета-роли в порядке редактора. `token` — CSS-переменная в формате «R G B». */
export const CUSTOM_COLOR_TOKENS = [
  { key: "bg", token: "--c-bg", label: "Фон" },
  { key: "panel", token: "--c-panel", label: "Карточки" },
  { key: "panel2", token: "--c-panel2", label: "Вторичный фон" },
  { key: "border", token: "--c-border", label: "Границы" },
  { key: "muted", token: "--c-muted", label: "Второстепенный текст" },
  { key: "text", token: "--c-text", label: "Текст" },
  { key: "accent", token: "--c-accent", label: "Акцент" },
  { key: "accentFg", token: "--c-accent-fg", label: "Текст на акценте" },
  { key: "accent2", token: "--c-accent2", label: "Второй акцент" },
  { key: "income", token: "--c-income", label: "Доходы" },
  { key: "expense", token: "--c-expense", label: "Расходы" },
  { key: "warn", token: "--c-warn", label: "Предупреждение" },
  { key: "onTone", token: "--c-on-tone", label: "Текст на цветной заливке" },
] as const;

export type CustomColorKey = (typeof CUSTOM_COLOR_TOKENS)[number]["key"];
/** Цвета своей темы — `#rrggbb` строчными. */
export type CustomColors = Record<CustomColorKey, string>;

export interface CustomTheme {
  /** С какой готовой темы скопирована — к ней возвращает «Сбросить». */
  base: string;
  colors: CustomColors;
}

/** Тени поддона — как у готовых тем своего вида. */
const SHADOW: Record<ThemeKind, string> = {
  light: "0 24px 60px -28px rgba(15, 23, 42, 0.22)",
  dark: "0 30px 70px -30px rgba(0, 0, 0, 0.7)",
};

/** Минимальный контраст текста по WCAG AA. */
export const MIN_CONTRAST = 4.5;

// ── Цвета ──

/**
 * Разобрать hex: `#abc`, `abc`, `#aabbcc`, `AABBCC`. Вернуть `#aabbcc`
 * строчными или `null`, если это не цвет.
 */
export function normalizeHex(input: string): string | null {
  const s = input.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`;
  if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`;
  return null;
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const h = normalizeHex(hex);
  if (!h) return null;
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const part = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** Токен «R G B» (как в index.css) → `#rrggbb`. */
export function tripletToHex(triplet: string): string | null {
  const parts = triplet.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
  return rgbToHex(parts[0], parts[1], parts[2]);
}

/** `#rrggbb` → «R G B» для токена. */
export function hexToTriplet(hex: string): string {
  const rgb = hexToRgb(hex) ?? [0, 0, 0];
  return rgb.join(" ");
}

/** Относительная яркость по WCAG 2.x. */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Контраст двух цветов по WCAG: от 1 до 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** «4,5:1» — с одним знаком, запятой. */
export function formatContrast(ratio: number): string {
  return `${(Math.floor(ratio * 10) / 10).toFixed(1).replace(".", ",")}:1`;
}

/** Пары, контраст которых проверяет редактор: у какого цвета и с каким. */
export const CONTRAST_CHECKS = [
  { key: "text", against: "bg", label: "с фоном" },
  { key: "accentFg", against: "accent", label: "с акцентом" },
] as const satisfies readonly { key: CustomColorKey; against: CustomColorKey; label: string }[];

// ── Тема целиком ──

/** Все токены своей темы, включая выведенные. */
export function customThemeVars(kind: ThemeKind, colors: CustomColors): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const t of CUSTOM_COLOR_TOKENS) vars[t.token] = hexToTriplet(colors[t.key]);
  vars["--shadow-tray"] = SHADOW[kind];
  vars["--grid"] = colors.border;
  vars["--tooltip-bg"] = colors.panel;
  vars["--tooltip-border"] = colors.border;
  return vars;
}

/** CSS-блок своей темы — тот же вид, что у готовых в index.css. */
export function customThemeCss(kind: ThemeKind, colors: CustomColors): string {
  const body = Object.entries(customThemeVars(kind, colors))
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");
  return `[data-scheme="${customSchemeId(kind)}"] {\n${body}\n}`;
}

/**
 * Проверить пришедшее (из localStorage, облака, бэкапа): все цвета на месте и
 * разбираются. Иначе `null` — лучше готовая тема, чем полупустая своя.
 */
export function parseCustomTheme(v: unknown): CustomTheme | null {
  let obj: unknown = v;
  if (typeof v === "string") {
    try {
      obj = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const { base, colors } = obj as { base?: unknown; colors?: unknown };
  if (typeof base !== "string" || !colors || typeof colors !== "object") return null;
  const out = {} as CustomColors;
  for (const t of CUSTOM_COLOR_TOKENS) {
    const raw = (colors as Record<string, unknown>)[t.key];
    const hex = typeof raw === "string" ? normalizeHex(raw) : null;
    if (!hex) return null;
    out[t.key] = hex;
  }
  return { base, colors: out };
}

export function sameCustomTheme(a: CustomTheme | null, b: CustomTheme | null): boolean {
  if (!a || !b) return a === b;
  return a.base === b.base && CUSTOM_COLOR_TOKENS.every((t) => a.colors[t.key] === b.colors[t.key]);
}

// ── Браузер ──

/**
 * Цвета готовой темы — прямо из index.css: временный элемент с её пометкой и
 * вычисленные значения токенов. Так копия всегда совпадает с темой.
 */
export function readSchemeColors(schemeId: string): CustomColors | null {
  if (typeof document === "undefined") return null;
  const probe = document.createElement("div");
  probe.setAttribute("data-scheme", schemeId);
  probe.style.display = "none";
  document.body.appendChild(probe);
  try {
    const cs = getComputedStyle(probe);
    const out = {} as CustomColors;
    for (const t of CUSTOM_COLOR_TOKENS) {
      const hex = tripletToHex(cs.getPropertyValue(t.token));
      if (!hex) return null;
      out[t.key] = hex;
    }
    return out;
  } finally {
    probe.remove();
  }
}

const STYLE_ID = "dzen-custom-scheme";

/** Положить блоки своих тем в `<head>` (или убрать, если тем нет). */
export function injectCustomThemes(themes: Record<ThemeKind, CustomTheme | null>): void {
  if (typeof document === "undefined") return;
  const css = (["light", "dark"] as const)
    .map((kind) => {
      const t = themes[kind];
      return t ? customThemeCss(kind, t.colors) : "";
    })
    .filter(Boolean)
    .join("\n");
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!css) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  if (el.textContent !== css) el.textContent = css;
}
