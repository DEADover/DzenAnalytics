import type { ScenarioEvent } from "./whatif";
import { chartColor } from "./format";
import { MONTHS, MONTHS_SHORT } from "./months";
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

export interface AxisTicks {
  /** Месяцы делений, `YYYY-MM`. */
  ticks: string[];
  /** Подпись деления. */
  label: (ym: string) => string;
}

/**
 * Деления оси времени — на круглых датах и не гуще восьми.
 *
 * Прежде шаг считался от начала графика: деления падали на сентябри, а
 * последнюю подпись библиотека дорисовывала сама и ставила вплотную к
 * соседней («2086 2096»). Теперь деления — январи круглых лет (2030, 2040…),
 * а на коротком горизонте — месяцы с круглым шагом.
 */
export function axisTicks(months: readonly string[]): AxisTicks {
  const span = months.length - 1;
  if (span <= 36) {
    const step = [1, 2, 3, 6].find((s) => span / s <= 8) ?? 12;
    return {
      ticks: months.filter((ym) => (Number(ym.slice(5)) - 1) % step === 0),
      label: (ym) => `${MONTHS_SHORT[Number(ym.slice(5)) - 1]} ${ym.slice(2, 4)}`,
    };
  }
  const years = span / 12;
  const step = [1, 2, 5, 10, 20].find((s) => years / s <= 8) ?? 25;
  return {
    ticks: months.filter((ym) => ym.endsWith("-01") && Number(ym.slice(0, 4)) % step === 0),
    label: (ym) => ym.slice(0, 4),
  };
}
