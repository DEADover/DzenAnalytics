/**
 * «Сделать регулярной»: новый план Дзен-мани по образцу операции.
 *
 * План в Дзен-мани — правило (`reminder`) и по «дате» (`reminderMarker`) на
 * каждое повторение. Как заполнены правила у живых планов (сверено
 * 01.10.2026, только чтение): `interval: "month"`, `step: 1`, `points: [0]`,
 * день повтора — день `startDate`. Даты лежат примерно на год вперёд.
 *
 * Даты создаём сами: напоминание, присланное через API без дат, плановых
 * операций не порождает (проверено 16.09.2026). Id — новые uuid, собираются
 * ОДИН раз, при постановке в очередь: повторная отправка не плодит дублей.
 *
 * Расписание — `lib/planSchedule`: неделя пишется так же, как в самом
 * приложении (`interval: "day"`, `step: 7·N`, дни недели — `points`).
 *
 * Проверено на тестовом аккаунте 01.10.2026: сервер принимает правило и все
 * 12 дат с нашими id, своих не досоздаёт; мобильное приложение после
 * синхронизации тоже не достраивает даты поверх. Удаление правила уносит все
 * его даты.
 */
import type { ZenReminder, ZenReminderMarker, ZenTransaction } from "./zenmoney";
import { planHorizon, scheduleDates, scheduleToReminder, type PlanSchedule } from "./planSchedule";

export interface NewPlanInput {
  /** Операция-образец — ноги, счета, категория, получатель. */
  tx: ZenTransaction;
  /** Сумма главной ноги (списание у расхода и перевода, зачисление у дохода). */
  amount: number;
  schedule: PlanSchedule;
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
  const rule = scheduleToReminder(input.schedule);
  const reminder: ZenReminder = {
    id: opts.uuid(),
    user: tx.user,
    changed: opts.stamp,
    interval: rule.interval,
    step: rule.step,
    points: rule.points,
    startDate: rule.startDate,
    endDate: rule.endDate,
    notify: true,
    ...legs,
  };
  const markers = scheduleDates(input.schedule, rule.startDate, planHorizon(opts.today)).map(
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
