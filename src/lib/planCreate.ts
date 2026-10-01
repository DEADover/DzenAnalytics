/**
 * «Сделать регулярной»: новый план Дзен-мани по образцу операции.
 *
 * План в Дзен-мани — правило (`reminder`) и по «дате» (`reminderMarker`) на
 * каждое повторение. Как заполнены правила у живых планов (сверено
 * 01.10.2026, только чтение): `interval: "month"`, `step: 1`, `points: [0]`,
 * день повтора — день `startDate`. Даты лежат примерно на год вперёд.
 *
 * Даты создаём сами: напоминание, присланное через API без дат, плановых
 * операций не порождает (проверено 16.09.2026), а приложения Дзен-мани
 * достраивают их по своему правилу. Id — новые uuid, собираются ОДИН раз, при
 * постановке в очередь: повторная отправка того же действия не плодит дублей.
 */
import type { ZenReminder, ZenReminderMarker, ZenTransaction } from "./zenmoney";

export type PlanInterval = "week" | "month" | "year";

/** Даты на сколько месяцев вперёд — как у Дзен-мани (≈12 у месячного плана). */
export const PLAN_HORIZON_MONTHS = 12;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(`${s}T00:00:00Z`);

/**
 * Сдвиг даты на `n` периодов. У месяца и года день сохраняется, а если в
 * месяце его нет — последнее число (31 января → 28 февраля → 31 марта:
 * каждый раз считаем от начала, а не от прошлой даты, чтобы день не «съезжал»).
 */
export function addInterval(start: string, interval: PlanInterval, n: number): string {
  const d = parse(start);
  if (interval === "week") {
    d.setUTCDate(d.getUTCDate() + 7 * n);
    return iso(d);
  }
  const months = interval === "month" ? n : 12 * n;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const day = d.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(y, m, Math.min(day, last))));
}

/** Даты повторов с `start` (включительно) до `end` или горизонта. */
export function occurrenceDates(
  start: string,
  interval: PlanInterval,
  step: number,
  end: string | null,
  horizon: string
): string[] {
  const limit = end && end < horizon ? end : horizon;
  const out: string[] = [];
  for (let k = 0; ; k++) {
    const d = addInterval(start, interval, k * Math.max(1, step));
    if (d > limit || out.length >= 400) break;
    out.push(d);
  }
  return out;
}

/** Ближайшая дата повтора не раньше `from`: следующая после операции, но не в прошлом. */
export function firstOccurrence(opDate: string, interval: PlanInterval, step: number, from: string): string {
  for (let k = 1; ; k++) {
    const d = addInterval(opDate, interval, k * Math.max(1, step));
    if (d >= from || k > 1000) return d;
  }
}

export interface NewPlanInput {
  /** Операция-образец — ноги, счета, категория, получатель. */
  tx: ZenTransaction;
  /** Сумма главной ноги (списание у расхода и перевода, зачисление у дохода). */
  amount: number;
  interval: PlanInterval;
  step: number;
  startDate: string;
  endDate: string | null;
  comment: string | null;
}

export interface NewPlan {
  reminder: ZenReminder;
  markers: ZenReminderMarker[];
}

/**
 * Собрать правило и даты. `uuid` — генератор id (в тестах — счётчик),
 * `today` — от него считается горизонт.
 */
export function buildNewPlan(
  input: NewPlanInput,
  opts: { uuid: () => string; today: string; stamp: number }
): NewPlan {
  const { tx } = input;
  const transfer = tx.income > 0 && tx.outcome > 0 && tx.incomeAccount !== tx.outcomeAccount;
  const expense = !transfer && tx.outcome > 0;
  // Ноги — как у образца, сумма — новая. У перевода между валютами
  // зачисление меняется в той же пропорции.
  const outcome = transfer || expense ? input.amount : 0;
  const income = transfer
    ? tx.incomeInstrument === tx.outcomeInstrument
      ? input.amount
      : Math.round((tx.income * input.amount * 100) / tx.outcome) / 100
    : expense
      ? 0
      : input.amount;
  const legs = {
    income,
    incomeInstrument: tx.incomeInstrument,
    incomeAccount: tx.incomeAccount,
    outcome,
    outcomeInstrument: tx.outcomeInstrument,
    outcomeAccount: tx.outcomeAccount,
    tag: tx.tag,
    payee: tx.payee,
    merchant: tx.merchant,
    comment: input.comment,
  };
  const reminder: ZenReminder = {
    id: opts.uuid(),
    user: tx.user,
    changed: opts.stamp,
    interval: input.interval,
    step: Math.max(1, input.step),
    points: [0],
    startDate: input.startDate,
    endDate: input.endDate,
    notify: true,
    ...legs,
  };
  const horizon = addInterval(opts.today, "month", PLAN_HORIZON_MONTHS);
  const markers = occurrenceDates(input.startDate, input.interval, input.step, input.endDate, horizon).map(
    (date): ZenReminderMarker => ({
      id: opts.uuid(),
      user: tx.user,
      changed: opts.stamp,
      date,
      reminder: reminder.id,
      state: "planned",
      isForecast: false,
      notify: true,
      ...legs,
    })
  );
  return { reminder, markers };
}

/** «Каждый месяц», «каждые 2 недели», «каждый год». */
export function intervalLabel(interval: PlanInterval, step: number): string {
  const n = Math.max(1, step);
  if (n === 1) return { week: "Каждую неделю", month: "Каждый месяц", year: "Каждый год" }[interval];
  const forms = {
    week: ["неделю", "недели", "недель"],
    month: ["месяц", "месяца", "месяцев"],
    year: ["год", "года", "лет"],
  }[interval];
  const mod10 = n % 10;
  const mod100 = n % 100;
  const form = mod10 === 1 && mod100 !== 11 ? forms[0] : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? forms[1] : forms[2];
  return `Каждые ${n} ${form}`;
}
