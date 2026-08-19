/**
 * Расчёты главной страницы, вынесенные из вёрстки.
 *
 * Здесь живёт то, чего главной не хватало и что нельзя посчитать «на глаз»:
 * насколько месяц прожит, идём ли мы быстрее обычного и сколько денег
 * останется свободными к последнему числу. Всё — чистые функции: они
 * покрыты тестами и одинаковы для всех вариантов страницы.
 */

import type { Currency, CurrencyRates } from "../types";
import type { RecurringCandidate } from "./aggregations";
import { toBase } from "./csv";

/** Сколько дней месяца прожито и какая это доля. */
export interface MonthProgress {
  /** Номер дня внутри периода, 1-индексированный. Для прошлого месяца = `days`. */
  day: number;
  /** Длина периода в днях. */
  days: number;
  /** `day / days`, от 0 до 1. */
  progress: number;
  /** Сколько дней осталось до конца периода. Ноль у завершённого месяца. */
  left: number;
  /** Период ещё идёт — значит сравнивать его с полным месяцем нельзя. */
  running: boolean;
}

/**
 * Прогресс календарного месяца `ym` относительно момента `now`.
 *
 * Будущий месяц — это ноль прожитых дней, а не «ещё не начался»: так вызывающей
 * стороне не нужно отдельно разбирать этот случай, доли просто выходят нулевыми.
 */
export function monthProgress(ym: string, now: Date = new Date()): MonthProgress {
  const year = Number(ym.slice(0, 4));
  const month = Number(ym.slice(5, 7));
  const days = new Date(year, month, 0).getDate();
  const startsAt = new Date(year, month - 1, 1).getTime();
  const endsAt = new Date(year, month, 1).getTime();
  const t = now.getTime();

  if (t >= endsAt) return { day: days, days, progress: 1, left: 0, running: false };
  if (t < startsAt) return { day: 0, days, progress: 0, left: days, running: false };

  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getDate();
  return { day, days, progress: day / days, left: days - day, running: true };
}

/**
 * Во сколько раз темп трат отличается от обычного.
 *
 * Сравнивать факт неполного месяца с полным прошлым нельзя — именно так на
 * старой главной появлялось «↓ 58 %» в середине месяца. Поэтому среднее за
 * прошлые месяцы урезается до прожитой доли текущего: 18 дней сравниваются с
 * 18 днями, а не с 31.
 *
 * `null` — сравнивать не с чем: нет истории или месяц ещё не начался.
 */
export function paceRatio(
  factExpense: number,
  progress: number,
  avgMonthExpense: number
): number | null {
  if (progress <= 0 || avgMonthExpense <= 0) return null;
  const expectedByNow = avgMonthExpense * progress;
  if (expectedByNow <= 0) return null;
  return factExpense / expectedByNow;
}

/** Ожидаемый расход к концу месяца по текущему темпу. */
export function projectExpense(factExpense: number, progress: number): number {
  if (progress <= 0) return 0;
  return factExpense / progress;
}

export interface UpcomingPayment {
  payee: string;
  category: string;
  /** Дата ближайшего ожидаемого платежа, YYYY-MM-DD. */
  date: string;
  /** Через сколько дней от «сегодня». Ноль — сегодня. */
  inDays: number;
  /** Сумма в валюте самого платежа — её и показываем в строке. */
  amount: number;
  currency: Currency;
  /** Та же сумма в базовой валюте — только её можно складывать. */
  amountBase: number;
}

/**
 * Регулярные платежи, ожидаемые с `from` по `until` включительно.
 *
 * Отдаёт и сумму в валюте платежа, и её же в базовой. На старой главной строки
 * печатались в своей валюте, а итог складывал те же числа без пересчёта —
 * долларовая подписка попадала в рублёвый итог как девять рублей.
 */
export function upcomingPayments(
  candidates: RecurringCandidate[],
  rates: CurrencyRates,
  from: string,
  until: string
): UpcomingPayment[] {
  const fromMs = Date.parse(from);
  return candidates
    .filter((c) => !c.stale && c.nextExpected >= from && c.nextExpected <= until)
    .map((c) => ({
      payee: c.payee,
      category: c.category,
      date: c.nextExpected,
      inDays: Math.max(0, Math.round((Date.parse(c.nextExpected) - fromMs) / 86400000)),
      amount: c.avgAmount,
      currency: c.currency,
      amountBase: toBase(c.avgAmount, c.currency, rates),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Сумма платежей в базовой валюте — складывать можно только её. */
export function upcomingTotal(payments: UpcomingPayment[]): number {
  return payments.reduce((s, p) => s + p.amountBase, 0);
}

export interface FreeMoney {
  /** Сколько останется свободными к концу периода. */
  value: number;
  /** Ожидаемый доход, из которого считали. */
  income: number;
  /** Уже потрачено с начала периода. */
  spent: number;
  /** Обязательные платежи, которые ещё впереди. */
  ahead: number;
}

/**
 * Свободные деньги до конца месяца.
 *
 * Ожидаемый доход минус уже потраченное минус то, что точно спишется. Доход
 * берётся прогнозный, а не фактический: зарплата приходит одним днём, и до неё
 * фактический доход месяца близок к нулю — «свободно −143 000 ₽» было бы
 * честным по арифметике и бессмысленным по существу.
 */
export function freeMoney(opts: {
  projIncome: number;
  factExpense: number;
  aheadObligatory: number;
}): FreeMoney {
  const { projIncome, factExpense, aheadObligatory } = opts;
  return {
    value: projIncome - factExpense - aheadObligatory,
    income: projIncome,
    spent: factExpense,
    ahead: aheadObligatory,
  };
}

/**
 * Верх шкалы, устойчивый к выбросам.
 *
 * Один месяц с покупкой машины прижимает остальные четырнадцать ко дну: при
 * максимуме 2,4 млн обычный месяц в 560 тысяч занимает пятую часть высоты, и
 * график перестаёт отвечать на вопрос «а какой у меня обычный ритм». Поэтому
 * шкала строится по девятому дециля с небольшим запасом, а всё, что выше,
 * рисуется срезанным — с числом рядом, чтобы величину не потерять.
 *
 * Если выброса нет, ничего не режем: `clipped` вернётся `false`, а `cap`
 * совпадёт с настоящим максимумом.
 */
export function robustCeiling(
  values: number[],
  quantile = 0.9,
  headroom = 1.15
): { cap: number; clipped: boolean } {
  const pos = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (pos.length === 0) return { cap: 0, clipped: false };
  const max = pos[pos.length - 1];
  if (pos.length < 4) return { cap: max, clipped: false };
  const q = pos[Math.min(pos.length - 1, Math.floor(quantile * (pos.length - 1)))];
  const cap = q * headroom;
  // Небольшое превышение резать незачем — только испортим шкалу ради пары
  // процентов. Режем, когда максимум выбивается заметно.
  if (max <= cap * 1.05) return { cap: max, clipped: false };
  return { cap, clipped: true };
}

/** Последний день месяца `ym` в виде YYYY-MM-DD. */
export function monthEnd(ym: string): string {
  const year = Number(ym.slice(0, 4));
  const month = Number(ym.slice(5, 7));
  const days = new Date(year, month, 0).getDate();
  return `${ym}-${String(days).padStart(2, "0")}`;
}

/**
 * Ступень тепловой шкалы для суммы `v`, от 0 до `steps`.
 *
 * Ноль — это отдельная ступень «трат не было», а не самый бледный оттенок:
 * пустой день и день на сто рублей — разные вещи, и шкала обязана их различать.
 */
export function heatStep(v: number, max: number, steps = 4): number {
  if (v <= 0 || max <= 0) return 0;
  const step = Math.ceil((v / max) * steps);
  return Math.min(steps, Math.max(1, step));
}
