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
  /** Комментарий последнего такого платежа, если он был. */
  comment?: string;
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
  until: string,
  /** Комментарий последнего платежа группы — по нему часто и понятно, что это. */
  commentFor?: (c: RecurringCandidate) => string | undefined
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
      comment: commentFor?.(c) || undefined,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Сумма платежей в базовой валюте — складывать можно только её. */
export function upcomingTotal(payments: UpcomingPayment[]): number {
  return payments.reduce((s, p) => s + p.amountBase, 0);
}

export interface FreeMoney {
  /** Доход периода минус расход. Отрицательное — потрачено больше, чем пришло. */
  value: number;
  /** Фактический доход периода. */
  income: number;
  /** Фактически потрачено с начала периода. */
  spent: number;
}

/**
 * Сальдо месяца: доход минус расход, и только ФАКТ.
 *
 * Будущих списаний здесь нет намеренно. Раньше из суммы вычитались регулярные
 * платежи, которые DzenAnalytics вычисляет по истории, — но у Дзен-мани есть
 * ещё и свои планы, и какие из двух имел в виду человек, неизвестно. Число,
 * собранное из факта и одной из двух догадок, невозможно ни проверить, ни
 * объяснить: на экране стоят доход и расход, а итог с ними не сходится.
 * Запланированные операции живут своим виджетом, там их и видно — обоими
 * способами, на выбор.
 *
 * Прогнозировать доход по темпу тоже нельзя: зарплата приходит одним днём, и
 * линейная экстраполяция даёт то тридцатикратное завышение, то ноль (этот же
 * разбор есть в `buildMonthCashflow`). Подставлять вместо факта среднее за
 * прошлые месяцы нельзя по той же причине: на экране появлялся «прогноз дохода
 * 543 800 ₽» там, где месяц принёс 158 994 ₽.
 *
 * Плановые суммы, если они у пользователя заведены, показываются отдельной
 * строкой и не смешиваются с фактом.
 */
export function freeMoney(opts: { factIncome: number; factExpense: number }): FreeMoney {
  const { factIncome, factExpense } = opts;
  return { value: factIncome - factExpense, income: factIncome, spent: factExpense };
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


/** Медиана — типичное значение ряда, устойчивое к одиночным выбросам. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export interface ForecastMonth {
  ym: string;
  income: number;
  expense: number;
  isForecast: boolean;
}

/**
 * Прогноз на несколько месяцев вперёд.
 *
 * Две вещи, которых не делал прежний расчёт:
 *
 *   • **текущий месяц не участвует в среднем.** Он неполный — девятнадцатого
 *     числа в нём две трети трат, — и попадая в окно, занижал прогноз на все
 *     месяцы вперёд;
 *   • **месяцы различаются.** Раньше на все три ставилось одно и то же
 *     среднее, и три одинаковых столбца выглядели как ошибка. Теперь среднее
 *     умножается на сезонный коэффициент своего календарного месяца — если
 *     истории хватает, чтобы его посчитать.
 *
 * Коэффициент считается только по ЗАВЕРШЁННЫМ месяцам и только когда этот
 * календарный месяц встречался в истории не меньше двух раз: по одному
 * декабрю судить о декабрях нельзя. Он зажат в пределах ±40 %, иначе один
 * ремонт в мае объявил бы май вечно дорогим.
 */
export function forecastMonths(
  complete: { ym: string; income: number; expense: number }[],
  monthsAhead = 3,
  lookback = 6,
  /**
   * С какого месяца отсчитывать прогноз — первый прогнозный будет следующим за
   * ним. По умолчанию это последний завершённый месяц из `complete`.
   *
   * Разделено намеренно: считать «обычный месяц» надо по завершённым, иначе
   * половина текущего занизила бы медиану, — а РИСОВАТЬ прогноз надо после
   * последнего показанного месяца. Пока это было одно и то же значение, текущий
   * месяц попадал на график дважды: столбцом факта и столбцом прогноза, и на
   * оси стояли две одинаковые подписи подряд.
   */
  startAfter?: string
): ForecastMonth[] {
  if (complete.length === 0) return [];

  // Везде медиана, а не среднее. «Обычный месяц» — это типичный месяц, и одна
  // покупка машины не должна поднимать прогноз на все месяцы вперёд: ровно та
  // же беда, из-за которой на графике пришлось срезать шкалу.
  const window = complete.slice(-lookback);
  const avgIncome = median(window.map((m) => m.income));
  const avgExpense = median(window.map((m) => m.expense));

  // Сезонный множитель календарного месяца: во сколько раз он обычно
  // отличается от типичного месяца за всю историю.
  const overall = median(complete.map((m) => m.expense));
  const byCalendarMonth = new Map<number, number[]>();
  for (const m of complete) {
    const idx = Number(m.ym.slice(5, 7)) - 1;
    const arr = byCalendarMonth.get(idx) ?? [];
    arr.push(m.expense);
    byCalendarMonth.set(idx, arr);
  }
  const factorFor = (monthIdx: number): number => {
    const arr = byCalendarMonth.get(monthIdx);
    if (!arr || arr.length < 2 || overall <= 0) return 1;
    // На двух точках медиана совпадает со средним — от перекоса спасает зажим.
    return Math.max(0.6, Math.min(1.4, median(arr) / overall));
  };

  const last = startAfter || complete[complete.length - 1].ym;
  const ly = Number(last.slice(0, 4));
  const lm = Number(last.slice(5, 7));

  const out: ForecastMonth[] = [];
  for (let i = 1; i <= monthsAhead; i++) {
    const d = new Date(ly, lm - 1 + i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const k = factorFor(d.getMonth());
    out.push({
      ym,
      income: avgIncome,
      expense: avgExpense * k,
      isForecast: true,
    });
  }
  return out;
}
