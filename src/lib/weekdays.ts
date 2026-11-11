/**
 * Дни недели по-русски — одним списком на весь сервис (как месяцы в
 * `lib/months.ts`). Неделя начинается с понедельника; варианты `_BY_JS_DAY`
 * — в порядке `Date.getDay()`, с воскресенья, чтобы брать день по номеру.
 */

/** Полные названия, с понедельника. */
export const WEEKDAYS = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];

/** Сокращённые, с понедельника: шапка календаря, подписи осей. */
export const WEEKDAYS_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

/** «По понедельникам» — для фраз о привычках по дням. */
export const WEEKDAYS_DATIVE = [
  "понедельникам",
  "вторникам",
  "средам",
  "четвергам",
  "пятницам",
  "субботам",
  "воскресеньям",
];

const byJsDay = (mondayFirst: string[]): string[] => [mondayFirst[6]!, ...mondayFirst.slice(0, 6)];

/** Полные — по номеру `getDay()` (0 — воскресенье). */
export const WEEKDAYS_BY_JS_DAY = byJsDay(WEEKDAYS);
/** Сокращённые — по номеру `getDay()`. */
export const WEEKDAYS_SHORT_BY_JS_DAY = byJsDay(WEEKDAYS_SHORT);
/** «По понедельникам» — по номеру `getDay()`. */
export const WEEKDAYS_DATIVE_BY_JS_DAY = byJsDay(WEEKDAYS_DATIVE);
