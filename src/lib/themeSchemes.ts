/**
 * Цветовые темы: по шесть на светлый и тёмный вид.
 *
 * Здесь только имена и подписи. Сами цвета — наборы токенов в `index.css`,
 * блок `[data-scheme="<id>"]` на каждую тему: так у цветов один источник, и
 * превью в настройках рисуется теми же токенами, что и приложение, — плитке
 * достаточно пометки `data-scheme`.
 *
 * Первая тема в каждом списке — прежняя, она же по умолчанию: у кого тема не
 * выбрана, ничего не меняется.
 */

export type ThemeKind = "light" | "dark";

export interface ThemeScheme {
  id: string;
  kind: ThemeKind;
  name: string;
  /** Одна короткая строка — чем тема отличается. */
  hint: string;
}

export const LIGHT_SCHEMES = [
  { id: "frost", kind: "light", name: "Иней", hint: "Холодные серые с лёгкой синевой" },
  { id: "gypsum", kind: "light", name: "Гипс", hint: "Чистые серые, белые карточки на сером фоне" },
  { id: "paper", kind: "light", name: "Бумага", hint: "Тёплый светлый, мягкий для глаз" },
  { id: "morning", kind: "light", name: "Утро", hint: "Светлый с голубым отливом" },
  { id: "mint", kind: "light", name: "Мята", hint: "Светлый в бирюзовом ключе логотипа" },
  { id: "contrast", kind: "light", name: "Контраст", hint: "Чёрный текст и чёткие линии" },
] as const satisfies readonly ThemeScheme[];

export const DARK_SCHEMES = [
  { id: "night", kind: "dark", name: "Ночь", hint: "Тёмно-синий фон, насыщенные цвета" },
  { id: "graphite", kind: "dark", name: "Графит", hint: "Холодный серый, чёткие ступени" },
  { id: "coal", kind: "dark", name: "Уголь", hint: "Тёплый тёмный, коралловый расход" },
  { id: "black", kind: "dark", name: "Чёрный", hint: "Чистый чёрный для OLED-экранов" },
  { id: "midnight", kind: "dark", name: "Полночь", hint: "Спокойный тёмно-синий, мягче «Ночи»" },
  { id: "lagoon", kind: "dark", name: "Лагуна", hint: "Тёмный в бирюзовом ключе логотипа" },
] as const satisfies readonly ThemeScheme[];

export type LightSchemeId = (typeof LIGHT_SCHEMES)[number]["id"];
export type DarkSchemeId = (typeof DARK_SCHEMES)[number]["id"];
export type SchemeId = LightSchemeId | DarkSchemeId;

export const DEFAULT_LIGHT_SCHEME: LightSchemeId = "frost";
export const DEFAULT_DARK_SCHEME: DarkSchemeId = "night";

export const ALL_SCHEMES = [...LIGHT_SCHEMES, ...DARK_SCHEMES] as const;

export function isLightSchemeId(v: unknown): v is LightSchemeId {
  return LIGHT_SCHEMES.some((s) => s.id === v);
}

export function isDarkSchemeId(v: unknown): v is DarkSchemeId {
  return DARK_SCHEMES.some((s) => s.id === v);
}

export function schemeById(id: string): (typeof ALL_SCHEMES)[number] | undefined {
  return ALL_SCHEMES.find((s) => s.id === id);
}
