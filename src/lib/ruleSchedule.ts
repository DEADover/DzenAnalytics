/**
 * Расписание автоприменения: как часто правило проходит по операциям и как
 * глубоко в прошлое смотрит (issue #75).
 *
 * Без расписания правило с галочкой «Авто» трогает только то, что пришло
 * последней синхронизацией. Этого мало для случая, ради которого расписание и
 * заводится: операция лежит в истории, человек поправил у неё комментарий — и
 * теперь она подходит под правило. Такую операцию «новой» никто не считает, и
 * без расписания она ждёт, пока за ней придут руками.
 *
 * ВАЖНО про «как часто». Приложение работает в браузере, а не на сервере:
 * «раз в день» здесь значит «не чаще раза в сутки, при первом открытии или
 * синхронизации после наступления срока». Ночью само ничего не произойдёт —
 * произойдёт утром, когда приложение откроют.
 *
 * Здесь только арифметика сроков и границ, чтобы её можно было проверить
 * тестом; кто и когда её вызывает — в `useDataStore`.
 */

/**
 * Как часто правило проходит по операциям.
 *
 * Минуты и часы — про открытое приложение: пока вкладка живёт, срок наступает
 * сам по таймеру. Дни и месяцы — про календарь: «раз в день» человек понимает
 * как «в новый день», а не «через 24 часа», и заход в 23:50 не должен отменять
 * утренний.
 */
export type ScheduleEvery = "minute" | "hour" | "day" | "month";
/** Как глубоко в прошлое смотреть от сегодняшнего дня. */
export type ScheduleDepth = "day" | "month" | "year" | "all";

export interface RuleSchedule {
  every: ScheduleEvery;
  /** Сколько единиц частоты. Нет поля — одна («раз в день» как и раньше). */
  everyN?: number;
  /** Единица глубины: день, месяц, год или «всё время». */
  depth: ScheduleDepth;
  /**
   * Сколько таких единиц. Нет поля — одна: ровно так расписание и записывалось
   * до появления настраиваемой глубины, и переписывать чужие правила ради
   * единицы незачем.
   */
  depthN?: number;
}

/** Сколько единиц глубины у расписания: без числа — одна. */
export function depthCount(schedule: { depthN?: number } | undefined): number {
  return positiveCount(schedule?.depthN);
}

/** Сколько единиц частоты у расписания: без числа — одна. */
export function everyCount(schedule: { everyN?: number } | undefined): number {
  return positiveCount(schedule?.everyN);
}

function positiveCount(raw: number | undefined): number {
  const n = Math.round(raw ?? 1);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 999) : 1;
}

import { pluralRu } from "./plural";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Пора ли запускать правило.
 *
 * `lastRun` — когда правило отработало в прошлый раз (ISO); пусто — не
 * отрабатывало ни разу, значит пора. Считаем по КАЛЕНДАРЮ, а не по «прошло 24
 * часа»: «раз в день» человек понимает как «в новый день», и запуск в 23:50 не
 * должен отменять утренний.
 */
export function isDue(
  schedule: RuleSchedule | undefined,
  lastRun: string | undefined,
  now: Date
): boolean {
  if (!schedule) return false;
  if (!lastRun) return true;
  const prev = new Date(lastRun);
  if (Number.isNaN(prev.getTime())) return true;
  const n = everyCount(schedule);
  // Минуты и часы меряем временем: «каждые 15 минут» — это про часы на стене,
  // а не про календарные клетки.
  if (schedule.every === "minute") return now.getTime() - prev.getTime() >= n * 60_000;
  if (schedule.every === "hour") return now.getTime() - prev.getTime() >= n * 3_600_000;
  // Дни и месяцы — по календарю: «раз в день» значит «в новый день».
  if (schedule.every === "day") return daysBetween(prev, now) >= n;
  return monthsBetween(prev, now) >= n;
}

/** Сколько календарных суток между датами — по клеткам календаря, не по часам. */
function daysBetween(a: Date, b: Date): number {
  const da = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const db = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((db - da) / DAY_MS);
}

/** Сколько календарных месяцев между датами. */
function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

/**
 * Нижняя граница по дате операции: «YYYY-MM-DD» включительно.
 *
 * `null` — границы нет, правило смотрит всю историю. Именно этот случай и
 * страшен: одна галочка переписывает годы истории и, при включённой отправке,
 * уносит это в Дзен-мани. Поэтому в интерфейсе он подписан отдельно.
 */
export function depthFrom(depth: ScheduleDepth, now: Date, n = 1): string | null {
  if (depth === "all") return null;
  const count = Math.max(1, Math.round(n));
  const d = new Date(now.getTime());
  // «За 1 день» — это сегодня, «за 3 дня» — сегодня и два предыдущих: человек
  // считает дни включительно, а не отступает на три дня назад.
  if (depth === "day") return iso(new Date(d.getTime() - (count - 1) * DAY_MS));
  if (depth === "month") return iso(new Date(d.getTime() - count * 30 * DAY_MS));
  return iso(new Date(d.getTime() - count * 365 * DAY_MS));
}

/** Попадает ли операция в глубину. Пустая дата — не попадает. */
export function withinDepth(date: string | undefined, from: string | null): boolean {
  if (!from) return true;
  if (!date) return false;
  return date.slice(0, 10) >= from;
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Короткая подпись расписания — та же и на кнопке, и в справке. */
/**
 * Совсем короткая подпись — одним словом, для значка режима в таблице.
 *
 * Полная («Раз в день · месяц») в строку не помещается, а частота в значке
 * нужна: без неё «Авто» у двух правил выглядит одинаково, хотя одно ходит по
 * истории каждый день, а другое трогает только новое.
 */
export function scheduleShort(schedule: RuleSchedule | undefined): string {
  if (!schedule) return "Только новые";
  const n = everyCount(schedule);
  // «Каждые 1 мин.» по-русски не говорят: у единицы своя форма.
  if (schedule.every === "minute") return n === 1 ? "Раз в минуту" : `Каждые ${n} мин.`;
  if (schedule.every === "hour") return n === 1 ? "Раз в час" : `Каждые ${n} ч.`;
  if (schedule.every === "day") return n === 1 ? "Ежедневно" : `Каждые ${n} дн.`;
  return n === 1 ? "Ежемесячно" : `Каждые ${n} мес.`;
}

export function scheduleLabel(schedule: RuleSchedule | undefined): string {
  if (!schedule) return "Только новые";
  return `${everyLabel(schedule)} · ${depthLabel(schedule)}`;
}

/** «Раз в день», «Каждые 15 минут» — частота словами. */
export function everyLabel(schedule: RuleSchedule): string {
  const n = everyCount(schedule);
  const forms: Record<ScheduleEvery, [string, string, string]> = {
    minute: ["минуту", "минуты", "минут"],
    hour: ["час", "часа", "часов"],
    day: ["день", "дня", "дней"],
    month: ["месяц", "месяца", "месяцев"],
  };
  if (n === 1) return `Раз в ${forms[schedule.every][0]}`;
  return `Каждые ${n} ${pluralRu(n, forms[schedule.every])}`;
}

/** «За 3 месяца», «за всё время» — глубина словами, с учётом числа. */
export function depthLabel(schedule: {
  depth: ScheduleDepth;
  depthN?: number;
}): string {
  if (schedule.depth === "all") return "всё время";
  const n = depthCount(schedule);
  const forms: Record<"day" | "month" | "year", [string, string, string]> = {
    day: ["день", "дня", "дней"],
    month: ["месяц", "месяца", "месяцев"],
    year: ["год", "года", "лет"],
  };
  return `${n} ${pluralRu(n, forms[schedule.depth])}`;
}

/**
 * Отметка о заходе правила: когда отработало и сколько операций поправило.
 *
 * Раньше в журнале лежала одна строка с датой. Этого мало: «правило работает»
 * — не то же самое, что «правило что-то сделало», и человек, включивший «Авто»,
 * спрашивает именно про второе. Старые записи (просто ISO-строка) читаются
 * как заход без числа: сколько он тогда изменил, мы честно не знаем.
 */
export interface RuleRun {
  at: string;
  changed?: number;
}

/** Прочитать отметку любого поколения. `null` — записи нет или она битая. */
export function readRun(value: unknown): RuleRun | null {
  if (typeof value === "string") return value ? { at: value } : null;
  if (value && typeof value === "object") {
    const v = value as { at?: unknown; changed?: unknown };
    if (typeof v.at === "string" && v.at) {
      const changed = typeof v.changed === "number" ? v.changed : undefined;
      return changed === undefined ? { at: v.at } : { at: v.at, changed };
    }
  }
  return null;
}

/**
 * Когда правило сработает в следующий раз — словами.
 *
 * Обещать час нельзя: приложение живёт в браузере и само по себе ночью не
 * просыпается. Но и говорить про «первое открытие» на языке программиста тоже
 * нельзя — человек не знает, что такое «открытие» и почему «уже пора». Поэтому
 * фраза называет ДЕЙСТВИЯ, после которых правило сработает: синхронизация или
 * заход в приложение.
 */
export function nextRunLabel(
  schedule: RuleSchedule | undefined,
  lastRun: string | undefined,
  now: Date
): string {
  if (!schedule) return "при каждой синхронизации — только новые";
  // Срок уже наступил: правило сработает на ближайшем поводе. Даты называть
  // нечего — она в прошлом, а ждать её человеку незачем.
  if (isDue(schedule, lastRun, now)) {
    return schedule.every === "minute" || schedule.every === "hour"
      ? "в ближайшую минуту"
      : "при следующем заходе или синхронизации";
  }
  // Минуты и часы отсчитываются от прошлого захода и идут сами, пока вкладка
  // открыта: тут можно назвать время, а не повод.
  if (schedule.every === "minute" || schedule.every === "hour") {
    const step = everyCount(schedule) * (schedule.every === "minute" ? 60_000 : 3_600_000);
    const left = Math.max(1, Math.round((new Date(lastRun!).getTime() + step - now.getTime()) / 60_000));
    return `примерно через ${left} ${pluralRu(left, ["минуту", "минуты", "минут"])} — само`;
  }
  const when =
    schedule.every === "day"
      ? dateWords(new Date(now.getTime() + DAY_MS))
      : dateWords(new Date(now.getFullYear(), now.getMonth() + 1, 1));
  return `${when}, при заходе в приложение`;
}

/** «17 августа» — дата словами, без года: он и так очевиден. */
function dateWords(d: Date): string {
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}
