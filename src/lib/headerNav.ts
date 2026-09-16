/**
 * Основное меню — какие разделы стоят в дорожке меню шапки, а какие в «Ещё».
 *
 * Настройка — упорядоченный список путей. Всё, чего в нём нет, живёт в
 * панели «Ещё»: основные разделы группой «Обзор», остальные — своими
 * группами, как раньше. По умолчанию в шапке прежние четыре раздела.
 *
 * Сколько разделов влезет, зависит от ширины окна, поэтому список — это
 * пожелание, а не обещание: не поместившиеся в шапку разделы шапка сама
 * отдаёт в «Ещё» первой группой (`fitCount`, `moreGroups`).
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

/** Группа не поместившихся — первой в «Ещё». */
export const OVERFLOW_GROUP_TITLE = "Не поместились в меню";
/** Основные разделы, убранные из шапки. Имя группы общее с крошками. */
export { PRIMARY_GROUP_TITLE };

/**
 * Группы панели «Ещё»: сначала разделы из шапки, которым не хватило места,
 * затем убранные основные, затем прежние группы без того, что стоит в шапке.
 * Пустые группы не показываются.
 */
export function moreGroups(items: readonly string[], overflow: readonly string[] = []): NavGroup[] {
  const inHeader = new Set(items);
  const groups: NavGroup[] = [
    { title: OVERFLOW_GROUP_TITLE, items: headerSections(overflow) },
    { title: PRIMARY_GROUP_TITLE, items: PRIMARY_SECTIONS.filter((s) => !inHeader.has(s.to)) },
    ...SECONDARY_GROUPS.map((g) => ({ title: g.title, items: g.items.filter((s) => !inHeader.has(s.to)) })),
  ];
  return groups.filter((g) => g.items.length > 0);
}

/**
 * Сколько пунктов влезает в дорожку подряд, с начала списка.
 *
 * `fixed` — всё, что есть в дорожке всегда: поля и кант самой дорожки, знак и
 * кнопка «Ещё». `gap` — промежуток между соседними элементами дорожки. Пункт,
 * который не влез, обрывает список: следующий за ним короткий не встаёт на его
 * место, иначе порядок в шапке переставал бы совпадать с настройкой.
 */
export function fitCount(itemWidths: readonly number[], available: number, fixed: number, gap: number): number {
  let used = fixed;
  let n = 0;
  for (const w of itemWidths) {
    const next = used + gap + w;
    if (next > available) break;
    used = next;
    n++;
  }
  return n;
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
