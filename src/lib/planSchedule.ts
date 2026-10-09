/**
 * Расписание повторяющегося плана — как его видит человек («каждые 2 недели,
 * по пн и чт») и как его хранит Дзен-мани (`reminder.interval/step/points`).
 *
 * Как хранит Дзен-мани (сверено 08.10.2026 по живым планам тестового
 * аккаунта):
 *   • месяц и год — `interval: "month" | "year"`, `step` — через сколько,
 *     `points: [0]`, день — из `startDate`;
 *   • неделя — НЕ `"week"`, а `interval: "day"`, `step: 7·N` и `points` —
 *     сдвиги в днях от `startDate`: `[0, 3]` у плана с понедельника — это
 *     понедельник и четверг; «каждые 2 недели» — `step: 14`;
 *   • просто «каждые N дней» — `interval: "day"`, `step: N`, `points: [0]`.
 * Наш прежний «Сделать регулярной» писал `interval: "week"` — сервер такое
 * принимает, и читать его тоже надо.
 *
 * Даты (`reminderMarker`) по расписанию строим сами: сервер их не создаёт, а
 * при смене расписания стирает все незакрытые (проверено 08.10.2026).
 */

export type ScheduleUnit = "day" | "week" | "month" | "year";

export interface PlanSchedule {
  unit: ScheduleUnit;
  /** Через сколько единиц: «каждые 2 недели» — 2. */
  every: number;
  /** Дни недели у недельного расписания: 0 — понедельник … 6 — воскресенье. */
  weekdays: number[];
  /** Первая дата. У месяца и года задаёт и день повторения. */
  startDate: string;
  /** Последняя дата включительно; `null` — без конца. */
  endDate: string | null;
}

/** Поля правила Дзен-мани, которые задают расписание. */
export interface ReminderSchedule {
  interval: string | null;
  step?: number | null;
  points?: number[] | null;
  startDate: string;
  endDate?: string | null;
}

/** Правило, которое пишем мы сами, — все поля заданы. */
export interface ReminderRule {
  interval: string;
  step: number;
  points: number[];
  startDate: string;
  endDate: string | null;
}

const MAX_EVERY = 99;
const parse = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** День недели: 0 — понедельник … 6 — воскресенье. */
export function weekdayOf(date: string): number {
  return (parse(date).getUTCDay() + 6) % 7;
}

export function addDays(date: string, n: number): string {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/**
 * Сдвиг на `n` месяцев с тем же днём, а если его нет — последнее число
 * (31 января → 28 февраля → 31 марта: всегда считаем от начала).
 */
export function addMonths(date: string, n: number): string {
  const d = parse(date);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const day = d.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(y, m, Math.min(day, last))));
}

const clampEvery = (n: number) => Math.min(MAX_EVERY, Math.max(1, Math.floor(n) || 1));

/** Расписание из правила Дзен-мани. `null` — разовый план или непонятное правило. */
export function scheduleFromReminder(r: ReminderSchedule): PlanSchedule | null {
  const step = Math.max(1, r.step ?? 1);
  const base = { startDate: r.startDate, endDate: r.endDate ?? null };
  switch (r.interval) {
    case "month":
    case "year":
      return { ...base, unit: r.interval, every: clampEvery(step), weekdays: [] };
    case "week":
      return { ...base, unit: "week", every: clampEvery(step), weekdays: [weekdayOf(r.startDate)] };
    case "day": {
      if (step % 7 === 0) {
        const start = weekdayOf(r.startDate);
        const points = r.points?.length ? r.points : [0];
        const days = [...new Set(points.filter((p) => p >= 0 && p < 7).map((p) => (start + p) % 7))].sort();
        return { ...base, unit: "week", every: clampEvery(step / 7), weekdays: days.length ? days : [start] };
      }
      return { ...base, unit: "day", every: clampEvery(step), weekdays: [] };
    }
    default:
      return null;
  }
}

/**
 * Первая дата недельного расписания — ближайший выбранный день недели не
 * раньше `startDate`: от неё Дзен-мани и отсчитывает сдвиги `points`.
 */
function weekStart(s: PlanSchedule): string {
  const days = s.weekdays.length ? s.weekdays : [weekdayOf(s.startDate)];
  const from = weekdayOf(s.startDate);
  const ahead = Math.min(...days.map((d) => (d - from + 7) % 7));
  return addDays(s.startDate, ahead);
}

/** Правило Дзен-мани из расписания — в том виде, в каком его пишет само приложение. */
export function scheduleToReminder(s: PlanSchedule): ReminderRule {
  const every = clampEvery(s.every);
  if (s.unit === "week") {
    const start = weekStart(s);
    const from = weekdayOf(start);
    const days = s.weekdays.length ? s.weekdays : [from];
    const points = [...new Set(days.map((d) => (d - from + 7) % 7))].sort((a, b) => a - b);
    return { interval: "day", step: 7 * every, points, startDate: start, endDate: s.endDate };
  }
  return { interval: s.unit, step: every, points: [0], startDate: s.startDate, endDate: s.endDate };
}

/**
 * Даты повторений с `from` по `horizon` включительно (и не дальше конца
 * расписания). Предохранитель — 400 дат: ежедневный план на год — 366.
 */
export function scheduleDates(s: PlanSchedule, from: string, horizon: string): string[] {
  const r = scheduleToReminder(s);
  const limit = s.endDate && s.endDate < horizon ? s.endDate : horizon;
  const out: string[] = [];
  const push = (d: string) => {
    if (d >= from && d <= limit) out.push(d);
  };
  const step = r.step ?? 1;
  if (r.interval === "month" || r.interval === "year") {
    const months = r.interval === "month" ? step : 12 * step;
    for (let k = 0; out.length < 400; k++) {
      const d = addMonths(r.startDate, k * months);
      if (d > limit) break;
      push(d);
    }
    return out;
  }
  const points = r.points?.length ? r.points : [0];
  for (let k = 0; out.length < 400; k++) {
    const base = addDays(r.startDate, k * step);
    if (base > limit) break;
    for (const p of points) if (p < step) push(addDays(base, p));
  }
  return out.sort();
}

function plural(n: number, forms: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}

export const WEEKDAY_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

/** «Каждый месяц», «Каждые 2 недели, по пн и чт», «Каждые 3 дня». */
export function scheduleLabel(s: PlanSchedule): string {
  const n = clampEvery(s.every);
  const unit = {
    day: { one: "Каждый день", forms: ["день", "дня", "дней"] as [string, string, string] },
    week: { one: "Каждую неделю", forms: ["неделю", "недели", "недель"] as [string, string, string] },
    month: { one: "Каждый месяц", forms: ["месяц", "месяца", "месяцев"] as [string, string, string] },
    year: { one: "Каждый год", forms: ["год", "года", "лет"] as [string, string, string] },
  }[s.unit];
  const head = n === 1 ? unit.one : `${n % 10 === 1 && n % 100 !== 11 ? "Каждый" : "Каждые"} ${n} ${plural(n, unit.forms)}`;
  if (s.unit !== "week" || s.weekdays.length === 0) return head;
  const days = [...s.weekdays].sort((a, b) => a - b).map((d) => WEEKDAY_SHORT[d]);
  const list = days.length === 1 ? days[0] : `${days.slice(0, -1).join(", ")} и ${days[days.length - 1]}`;
  return `${head}, по ${list}`;
}

/** Одинаковы ли два расписания по смыслу — чтобы не пересобирать даты зря. */
export function sameSchedule(a: PlanSchedule, b: PlanSchedule): boolean {
  const x = scheduleToReminder(a);
  const y = scheduleToReminder(b);
  return (
    x.interval === y.interval &&
    x.step === y.step &&
    JSON.stringify(x.points) === JSON.stringify(y.points) &&
    x.startDate === y.startDate &&
    (x.endDate ?? null) === (y.endDate ?? null)
  );
}

/** На сколько месяцев вперёд лежат даты плана — как у Дзен-мани (≈12 у месячного). */
export const PLAN_HORIZON_MONTHS = 12;

/** Горизонт дат плана от сегодняшнего дня. */
export function planHorizon(today: string): string {
  return addMonths(today, PLAN_HORIZON_MONTHS);
}

/**
 * Первый повтор по расписанию после операции `opDate` — но не в прошлом:
 * «Сделать регулярной» у вчерашней подписки начинает со следующего месяца.
 */
export function firstAfter(opDate: string, s: PlanSchedule, today: string): string {
  const from = addDays(opDate, 1) > today ? addDays(opDate, 1) : today;
  const weekdays = s.unit === "week" && s.weekdays.length === 0 ? [weekdayOf(opDate)] : s.weekdays;
  return scheduleDates({ ...s, weekdays, startDate: opDate, endDate: null }, from, addMonths(from, 12 * clampEvery(s.every) + 1))[0] ?? from;
}

/** Подпись расписания правила Дзен-мани; у разового плана — «Разово». */
export function reminderLabel(r: ReminderSchedule): string {
  const s = scheduleFromReminder(r);
  return s ? scheduleLabel(s) : "Разово";
}

/** Сегодня по местному времени — «ГГГГ-ММ-ДД»: даты плана — дни пользователя, не UTC. */
export function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
