import type { ScenarioEvent } from "./whatif";
import { chartColor } from "./format";
import { MONTHS } from "./months";
import { pluralRu } from "./plural";

/** Цвета серий «Что-если» — одни на графике, в легенде и в таблице. */
export const SERIES_COLOR = {
  now: chartColor.muted,
  active: chartColor.accent,
  compare: chartColor.accent2,
} as const;

/**
 * «Декабрь 2062» — месяц с полным годом. Прогноз уходит на десятилетия, и
 * «дек. 62 г.» читается как прошлое.
 */
export function monthYear(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

/** Процент без лишних нулей: «7,5», «4», «0,25». */
export function pctText(v: number): string {
  return v.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

/** «20 лет», «1 год 6 мес», «8 мес» — срок словами. */
export function durationText(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts: string[] = [];
  if (y) parts.push(`${y} ${pluralRu(y, ["год", "года", "лет"])}`);
  if (m || !y) parts.push(`${m} мес`);
  return parts.join(" ");
}

/** Когда событие случается — одной строкой под названием. */
export function eventWhen(e: ScenarioEvent): string {
  const start = monthYear(e.start);
  if (e.kind === "once") return `Разово · ${start}`;
  if (e.months == null) return `Каждый месяц с ${start}, без срока`;
  return `Каждый месяц с ${start} · ${durationText(e.months)}`;
}
