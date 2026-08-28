/**
 * Отчёт «Динамика» (issue #39) — отфильтрованные операции на временной оси.
 *
 * Что важно и чего нет в остальных графиках сервиса: пустые интервалы НЕ
 * пропускаются. Ряд строится по всем интервалам периода подряд, поэтому по
 * графику видно частоту трат — редкие всплески на фоне нулей, а не сплошную
 * линию из одних только дней с операциями. Ради этого же считаем «Среднее» по
 * всем интервалам, включая пустые: средний расход в день — это сумма, делённая
 * на все дни периода, а не на дни, когда что-то покупалось.
 */

import { periodKey, periodRange } from "./period";
import { monthLabel } from "./format";
import { expenseDelta, cashDelta } from "./txKindStyle";
import type { Transaction } from "../types";

export type DynamicsMetric = "expense" | "income" | "net" | "balance";
export type Granularity = "day" | "week" | "month" | "year";

export const METRIC_LABELS: Record<DynamicsMetric, string> = {
  expense: "Расходы",
  income: "Доходы",
  net: "Чистый доход",
  balance: "Баланс",
};

export const GRANULARITY_LABELS: Record<Granularity, string> = {
  day: "По дням",
  week: "По неделям",
  month: "По месяцам",
  year: "По годам",
};

/** Существительное интервала для подписи «Среднее за …». */
export const GRANULARITY_UNIT: Record<Granularity, string> = {
  day: "день",
  week: "неделю",
  month: "месяц",
  year: "год",
};

export interface DynamicsPoint {
  /** Сортируемый ключ интервала (ISO-дата его начала либо «2026»). */
  key: string;
  /** Компактная подпись для оси — с годом, но коротким: «1 янв 26». */
  label: string;
  /** Полная подпись для подсказки: «1 февраля 2026». На оси она не помещается,
   *  а вот при наведении неопределённость «какой это год» недопустима. */
  fullLabel: string;
  value: number;
  /** Только для «Расходов»: траты и возвраты по отдельности. Возврат гасит
   *  трату (так считает весь сервис), поэтому интервал, где вернули больше чем
   *  потратили, уходит в минус. Само по себе это выглядит ошибкой — разбивка в
   *  подсказке объясняет минус, не расходясь с остальными экранами. */
  gross?: number;
  refunds?: number;
}

export interface DynamicsSeries {
  points: DynamicsPoint[];
  /** Сумма по всем интервалам; для баланса — значение на конец периода. */
  total: number;
  /** Среднее по интервалам, включая пустые. */
  average: number;
  /** Сколько операций попало в отчёт. */
  count: number;
  /** Только для баланса: кривая привязана к реальным остаткам счетов. Если нет
   *  (режим CSV) — это накопленный поток с нуля, и говорить о нём надо иначе. */
  anchored: boolean;
}

/**
 * Данные для «Баланса». Остаток нельзя посчитать по отобранным операциям: он
 * складывается из НАЧАЛЬНОГО остатка счетов и всего их оборота, поэтому здесь
 * нужны все операции целиком и реальные остатки для привязки.
 */
export interface BalanceSource {
  /** Все операции без фильтров по категории и получателю. */
  all: Transaction[];
  /** Выбранные счета (null — все). */
  accounts: Set<string> | null;
  /** Реальные остатки по названиям счетов в базовой валюте (режим API).
   *  null — остатков нет, кривая пойдёт от нуля. */
  realBalances: Record<string, number> | null;
}

/**
 * Движение денег по счёту за операцию — обе ноги, включая переводы.
 *
 * Для всего портфеля переводы сами себя гасят, но стоит отобрать часть счетов —
 * и перевод наружу становится настоящим уменьшением остатка. Поэтому считаем
 * по ногам, а не через `cashDelta`.
 */
function accountDelta(t: Transaction, accounts: Set<string> | null): number {
  // У односторонней операции нога может быть пустой (небрежный CSV) — тогда
  // берём счёт-владельца операции, иначе сумма молча выпала бы из остатка.
  const out = t.outcomeAccount || t.account;
  const inc = t.incomeAccount || t.account;
  const inSet = (a: string) => !!a && (accounts === null || accounts.has(a));
  let delta = 0;
  if (t.kind === "expense") {
    if (inSet(out)) delta -= t.amountBase;
  } else if (t.kind === "income" || t.kind === "refund") {
    if (inSet(inc)) delta += t.amountBase;
  } else if (t.kind === "transfer") {
    // У перевода обе ноги настоящие; подставлять счёт-владельца нельзя — иначе
    // перевод «сам себе» схлопнется в ноль на обеих сторонах.
    if (inSet(t.outcomeAccount)) delta -= t.amountBase;
    if (inSet(t.incomeAccount)) delta += t.amountBase;
  }
  return delta;
}

/**
 * Сдвиг, который поднимает накопленный с нуля поток до настоящего остатка.
 *
 * Ровно тот же приём, что и у графика «Баланс по счетам» на «Счетах»: считаем
 * оборот каждого счёта за всю историю и прибавляем разницу с его реальным
 * остатком. Счета, остаток которых неизвестен (пришли из CSV), сдвига не дают —
 * их вклад остаётся потоком от нуля.
 */
function balanceOffset(src: BalanceSource): { offset: number; anchored: boolean } {
  if (!src.realBalances) return { offset: 0, anchored: false };
  const flowByAccount = new Map<string, number>();
  const bump = (acc: string, d: number) => {
    if (!acc) return;
    if (src.accounts !== null && !src.accounts.has(acc)) return;
    flowByAccount.set(acc, (flowByAccount.get(acc) ?? 0) + d);
  };
  for (const t of src.all) {
    // Те же подстановки пустой ноги, что и в accountDelta, — иначе сдвиг
    // считался бы по одному набору операций, а кривая по другому.
    if (t.kind === "expense") bump(t.outcomeAccount || t.account, -t.amountBase);
    else if (t.kind === "income" || t.kind === "refund")
      bump(t.incomeAccount || t.account, t.amountBase);
    else if (t.kind === "transfer") {
      bump(t.outcomeAccount, -t.amountBase);
      bump(t.incomeAccount, t.amountBase);
    }
  }
  let offset = 0;
  let anchored = false;
  for (const [acc, real] of Object.entries(src.realBalances)) {
    if (src.accounts !== null && !src.accounts.has(acc)) continue;
    offset += real - (flowByAccount.get(acc) ?? 0);
    anchored = true;
  }
  return { offset, anchored };
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Понедельник недели, в которую попадает дата. */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  // getUTCDay(): 0 — воскресенье, поэтому сдвигаем к понедельнику.
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return iso(d);
}

/** Ключ интервала, в который попадает операция. */
export function bucketKey(
  date: string,
  granularity: Granularity,
  monthStartDay: number
): string {
  const day = date.slice(0, 10);
  switch (granularity) {
    case "day":
      return day;
    case "week":
      return weekStart(day);
    case "month":
      // Учитываем свой первый день отчётного месяца, как и остальной сервис.
      return periodRange(periodKey(day, monthStartDay), monthStartDay).from;
    case "year":
      return day.slice(0, 4);
  }
}

/** Следующий интервал за данным — чтобы достроить пустые. */
function nextBucket(key: string, granularity: Granularity, monthStartDay: number): string {
  if (granularity === "year") return String(Number(key) + 1);
  const d = new Date(`${key}T00:00:00Z`);
  if (granularity === "day") d.setUTCDate(d.getUTCDate() + 1);
  else if (granularity === "week") d.setUTCDate(d.getUTCDate() + 7);
  else {
    // Месяц: шагаем на месяц вперёд от начала периода и снова нормализуем,
    // иначе при первом дне 31 числа шаг разъедется на коротких месяцах.
    d.setUTCDate(d.getUTCDate() + 32);
    return periodRange(periodKey(iso(d), monthStartDay), monthStartDay).from;
  }
  return iso(d);
}

const MONTHS_SHORT = [
  "янв", "фев", "мар", "апр", "мая", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
];

/** Родительный падеж — для полной даты «1 февраля 2026». */
const MONTHS_GENITIVE = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

const MONTHS_NOMINATIVE = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

function bucketLabels(
  key: string,
  granularity: Granularity
): { label: string; fullLabel: string } {
  if (granularity === "year") return { label: key, fullLabel: key };
  const [y, m, d] = key.split("-");
  const mi = Number(m) - 1;
  if (granularity === "month") {
    return { label: monthLabel(`${y}-${m}`), fullLabel: `${MONTHS_NOMINATIVE[mi]} ${y}` };
  }
  const short = `${Number(d)} ${MONTHS_SHORT[mi]} ${y.slice(2)}`;
  const full = `${Number(d)} ${MONTHS_GENITIVE[mi]} ${y}`;
  if (granularity === "week") {
    // Неделя подписана своим понедельником — в подсказке говорим об этом прямо,
    // иначе «1 фев» читается как один день, а не как семь.
    return { label: short, fullLabel: `Неделя с ${full}` };
  }
  return { label: short, fullLabel: full };
}

/** Метрики, которые складываются прямо из отобранных операций. Баланс сюда не
 *  входит — у него своя ветка, см. `buildBalance`. */
type FlowMetric = Exclude<DynamicsMetric, "balance">;

/** Вклад операции в выбранную метрику. */
function metricDelta(t: Transaction, metric: FlowMetric): number {
  switch (metric) {
    case "expense":
      return expenseDelta(t);
    case "income":
      return t.kind === "income" ? t.amountBase : 0;
    case "net":
      // Возврат для «чистого дохода» гасит расход — это и делает cashDelta.
      return cashDelta(t);
  }
}

/** Считается ли операция «попавшей в отчёт» для счётчика. */
function counts(t: Transaction, metric: FlowMetric): boolean {
  switch (metric) {
    case "expense":
      return t.kind === "expense" || t.kind === "refund";
    case "income":
      return t.kind === "income";
    default:
      return t.kind !== "transfer";
  }
}

/**
 * Собрать ряд.
 *
 * `from` / `to` задают ось: если период выбран явно, пустые интервалы на его
 * краях тоже попадут в график — иначе «за год» с одной операцией в декабре
 * выглядело бы как график из одной точки. Без них ось берётся по самим данным.
 */
export function buildDynamics(
  txs: Transaction[],
  metric: DynamicsMetric,
  granularity: Granularity,
  monthStartDay: number = 1,
  range?: { from: string | null; to: string | null },
  balance?: BalanceSource
): DynamicsSeries {
  if (metric === "balance") {
    return buildBalance(granularity, monthStartDay, range, balance ?? {
      all: txs,
      accounts: null,
      realBalances: null,
    });
  }
  const sums = new Map<string, number>();
  const gross = new Map<string, number>();
  const refunds = new Map<string, number>();
  let count = 0;
  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (const t of txs) {
    if (!t.date) continue;
    const day = t.date.slice(0, 10);
    if (minDate === null || day < minDate) minDate = day;
    if (maxDate === null || day > maxDate) maxDate = day;
    const delta = metricDelta(t, metric);
    if (counts(t, metric)) count++;
    const key = bucketKey(day, granularity, monthStartDay);
    if (metric === "expense") {
      if (t.kind === "expense") gross.set(key, (gross.get(key) ?? 0) + t.amountBase);
      else if (t.kind === "refund")
        refunds.set(key, (refunds.get(key) ?? 0) + t.amountBase);
    }
    if (delta === 0) continue;
    sums.set(key, (sums.get(key) ?? 0) + delta);
  }

  const startDay = range?.from ?? minDate;
  const endDay = range?.to ?? maxDate;
  if (!startDay || !endDay || startDay > endDay) {
    return { points: [], total: 0, average: 0, count, anchored: false };
  }

  const first = bucketKey(startDay, granularity, monthStartDay);
  const last = bucketKey(endDay, granularity, monthStartDay);

  const points: DynamicsPoint[] = [];
  // Предохранитель от бесконечного цикла на неожиданных данных: даже «по дням»
  // за 30 лет — это ~11 000 интервалов.
  for (let key = first, guard = 0; guard < 20000; key = nextBucket(key, granularity, monthStartDay), guard++) {
    const point: DynamicsPoint = {
      key,
      ...bucketLabels(key, granularity),
      value: sums.get(key) ?? 0,
    };
    if (metric === "expense" && (refunds.get(key) ?? 0) > 0) {
      point.gross = gross.get(key) ?? 0;
      point.refunds = refunds.get(key) ?? 0;
    }
    points.push(point);
    if (key >= last) break;
  }

  const total = points.reduce((s, p) => s + p.value, 0);
  const average = points.length ? total / points.length : 0;

  return { points, total, average, count, anchored: false };
}

/**
 * Баланс — отдельная ветка, и не из вредности.
 *
 * Остаток не выводится из отобранных операций: он равен начальному остатку
 * счёта плюс ВЕСЬ его оборот. Поэтому идём по всем операциям (фильтры по
 * категории и получателю к остатку неприменимы), копим поток по обеим ногам
 * каждой операции и в конце поднимаем всю кривую до реальных остатков. Иначе
 * график показывал бы «накоплено с нуля» и спокойно уходил в минус у человека
 * с миллионами на счетах.
 */
function buildBalance(
  granularity: Granularity,
  monthStartDay: number,
  range: { from: string | null; to: string | null } | undefined,
  src: BalanceSource
): DynamicsSeries {
  const perBucket = new Map<string, number>();
  let minDate: string | null = null;
  let maxDate: string | null = null;
  for (const t of src.all) {
    if (!t.date) continue;
    const day = t.date.slice(0, 10);
    if (minDate === null || day < minDate) minDate = day;
    if (maxDate === null || day > maxDate) maxDate = day;
    const delta = accountDelta(t, src.accounts);
    if (delta === 0) continue;
    const key = bucketKey(day, granularity, monthStartDay);
    perBucket.set(key, (perBucket.get(key) ?? 0) + delta);
  }
  if (!minDate || !maxDate) {
    return { points: [], total: 0, average: 0, count: 0, anchored: false };
  }

  const { offset, anchored } = balanceOffset(src);

  // Идём по ВСЕЙ истории, а показываем только выбранный период: иначе остаток
  // на его начало был бы нулём, а не тем, что человек реально накопил раньше.
  const first = bucketKey(minDate, granularity, monthStartDay);
  const lastAll = bucketKey(maxDate, granularity, monthStartDay);
  const fromKey = range?.from ? bucketKey(range.from, granularity, monthStartDay) : null;
  const toKey = range?.to ? bucketKey(range.to, granularity, monthStartDay) : null;

  const points: DynamicsPoint[] = [];
  let running = 0;
  let count = 0;
  for (let key = first, guard = 0; guard < 20000; key = nextBucket(key, granularity, monthStartDay), guard++) {
    running += perBucket.get(key) ?? 0;
    const afterStart = !fromKey || key >= fromKey;
    const beforeEnd = !toKey || key <= toKey;
    if (afterStart && beforeEnd) {
      points.push({
        key,
        ...bucketLabels(key, granularity),
        value: running + offset,
      });
    }
    if (key >= lastAll && (!toKey || key >= toKey)) break;
  }
  for (const t of src.all) {
    if (!t.date || t.kind === "transfer") continue;
    const day = t.date.slice(0, 10);
    if (range?.from && day < range.from) continue;
    if (range?.to && day > range.to) continue;
    if (accountDelta(t, src.accounts) !== 0) count++;
  }

  const total = points.at(-1)?.value ?? 0;
  const average = points.length
    ? points.reduce((s, p) => s + p.value, 0) / points.length
    : 0;
  return { points, total, average, count, anchored };
}
