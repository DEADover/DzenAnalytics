/**
 * Подпись дня для шапки группы в ленте: «Сегодня, 15 сентября», «Вчера, 14
 * сентября», «12 сентября», «3 марта 2025» — и день недели отдельно.
 */

import { MONTHS_GEN } from "./months";
import { WEEKDAYS_BY_JS_DAY } from "./weekdays";

const WEEKDAYS = WEEKDAYS_BY_JS_DAY.map((s) => s.toLowerCase());

export function formatDayHeader(ymd: string): { label: string; weekday: string } {
  const d = new Date(ymd);
  if (Number.isNaN(d.getTime())) return { label: ymd, weekday: "" };

  const today = new Date();
  const todayYmd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yYmd = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;

  const day = d.getDate();
  const month = MONTHS_GEN[d.getMonth()];
  const year = d.getFullYear();
  const weekday = WEEKDAYS[d.getDay()];
  const dateLabel = `${day} ${month}${year === today.getFullYear() ? "" : ` ${year}`}`;

  if (ymd === todayYmd) return { label: `Сегодня, ${dateLabel}`, weekday };
  if (ymd === yYmd) return { label: `Вчера, ${dateLabel}`, weekday };
  return { label: dateLabel, weekday };
}
