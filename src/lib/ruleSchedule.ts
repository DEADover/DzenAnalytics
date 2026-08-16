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

/** Как часто правило проходит по операциям. */
export type ScheduleEvery = "day" | "month";
/** Как глубоко в прошлое смотреть от сегодняшнего дня. */
export type ScheduleDepth = "day" | "month" | "year" | "all";

export interface RuleSchedule {
  every: ScheduleEvery;
  depth: ScheduleDepth;
}

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
  if (schedule.every === "day") return dayKey(prev) !== dayKey(now);
  return monthKey(prev) !== monthKey(now);
}

/**
 * Нижняя граница по дате операции: «YYYY-MM-DD» включительно.
 *
 * `null` — границы нет, правило смотрит всю историю. Именно этот случай и
 * страшен: одна галочка переписывает годы истории и, при включённой отправке,
 * уносит это в Дзен-мани. Поэтому в интерфейсе он подписан отдельно.
 */
export function depthFrom(depth: ScheduleDepth, now: Date): string | null {
  if (depth === "all") return null;
  const d = new Date(now.getTime());
  if (depth === "day") return iso(d);
  if (depth === "month") return iso(new Date(d.getTime() - 30 * DAY_MS));
  return iso(new Date(d.getTime() - 365 * DAY_MS));
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

function dayKey(d: Date): string {
  return iso(d);
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** Короткая подпись расписания — та же и на кнопке, и в справке. */
export function scheduleLabel(schedule: RuleSchedule | undefined): string {
  if (!schedule) return "Только новые";
  const every = schedule.every === "day" ? "Раз в день" : "Раз в месяц";
  const depth = { day: "день", month: "месяц", year: "год", all: "всё время" }[
    schedule.depth
  ];
  return `${every} · ${depth}`;
}
