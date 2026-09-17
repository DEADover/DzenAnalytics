/**
 * Основное меню — какие разделы стоят в дорожке меню шапки, а какие в «Ещё».
 *
 * Настройка — упорядоченный список путей. Всё, чего в нём нет, живёт в
 * панели «Ещё»: основные разделы группой «Обзор», остальные — своими
 * группами, как раньше. По умолчанию в шапке прежние четыре раздела.
 *
 * Всё, что человек поставил в меню, в меню и остаётся: не поместившиеся по
 * ширине разделы не уходят в «Ещё», а дорожка меню листается вбок (17.09.2026 —
 * раньше лишнее пряталось в «Ещё», и выбранный раздел приходилось искать там).
 */

import {
  ALL_SECTIONS,
  PRIMARY_GROUP_TITLE,
  PRIMARY_SECTIONS,
  SECONDARY_GROUPS,
  type NavSection,
} from "./navSections";

export const DEFAULT_HEADER_NAV: readonly string[] = PRIMARY_SECTIONS.map((s) => s.to);

const BY_PATH = new Map(ALL_SECTIONS.map((s) => [s.to, s]));

/** Раздел по пути среди всех, что можно поставить в шапку. */
export function headerSection(to: string): NavSection | undefined {
  return BY_PATH.get(to);
}

/**
 * Сохранённый список → рабочий: только известные разделы, без повторов.
 * Не массив (ничего не сохранено или мусор) — список по умолчанию. Пустой
 * массив — законный выбор: всё в «Ещё».
 */
export function normalizeHeaderNav(saved: unknown): string[] {
  if (!Array.isArray(saved)) return [...DEFAULT_HEADER_NAV];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of saved) {
    if (typeof item !== "string" || seen.has(item) || !BY_PATH.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

export function isDefaultHeaderNav(items: readonly string[]): boolean {
  return (
    items.length === DEFAULT_HEADER_NAV.length &&
    items.every((to, i) => to === DEFAULT_HEADER_NAV[i])
  );
}

export function headerSections(items: readonly string[]): NavSection[] {
  return items.map((to) => BY_PATH.get(to)).filter((s): s is NavSection => !!s);
}

export interface NavGroup {
  title: string;
  items: NavSection[];
}

/** Основные разделы, убранные из шапки. Имя группы общее с крошками. */
export { PRIMARY_GROUP_TITLE };

/**
 * Группы панели «Ещё»: убранные основные, затем прежние группы без того, что
 * стоит в шапке. Пустые группы не показываются.
 */
export function moreGroups(items: readonly string[]): NavGroup[] {
  const inHeader = new Set(items);
  const groups: NavGroup[] = [
    { title: PRIMARY_GROUP_TITLE, items: PRIMARY_SECTIONS.filter((s) => !inHeader.has(s.to)) },
    ...SECONDARY_GROUPS.map((g) => ({ title: g.title, items: g.items.filter((s) => !inHeader.has(s.to)) })),
  ];
  return groups.filter((g) => g.items.length > 0);
}

/**
 * Ширина кнопок меню в виде «Только значки»: ступень 0 — стандартная кнопка
 * (36 px, поля по бокам значка), дальше десять ступеней по 4 px — до 76 px.
 * Шире значок в кнопке уже теряется, а меню из десятка разделов не влезает.
 */
export const ICON_WIDTH_STEPS = 10;
export const ICON_WIDTH_BASE_PX = 36;
export const ICON_WIDTH_STEP_PX = 4;

export function normalizeIconWidth(saved: unknown): number {
  return typeof saved === "number" && Number.isInteger(saved) && saved >= 0 && saved <= ICON_WIDTH_STEPS
    ? saved
    : 0;
}

/** Ширина кнопки в пикселях для ступени; `null` у стандартной — ширину задают поля. */
export function iconButtonWidth(level: number): number | null {
  const l = normalizeIconWidth(level);
  return l === 0 ? null : ICON_WIDTH_BASE_PX + l * ICON_WIDTH_STEP_PX;
}

/** Переставить пункт на соседнее место. За краем списка — без изменений. */
export function moveItem(items: readonly string[], to: string, dir: -1 | 1): string[] {
  const i = items.indexOf(to);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= items.length) return [...items];
  const next = [...items];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
