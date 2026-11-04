/**
 * «Отчёт за период» — модель документа.
 *
 * Отчёт собирается из тех же расчётов, что и разделы сервиса, чтобы его числа
 * не расходились с экраном: итоги — `computeKPI` (как карточки «Cash-flow»),
 * помесячно — `groupByMonth`, категории — `buildHierarchy` (как «Категории»),
 * получатели и крупные траты — `topPayees` / `topTransactions` (как «Топ»),
 * наблюдения — `buildObservations` (как «Дайджест»). Здесь только чистая
 * сборка: остатки счетов и бюджет зависят от сторов и приходят из хука
 * страницы (`usePeriodReport`).
 */

import type { Transaction } from "../types";
import type { DatePreset } from "../store/useFiltersStore";
import {
  buildHierarchy,
  computeKPI,
  groupByMonth,
  topPayees,
  topTransactions,
} from "./aggregations";
import { buildObservations, type DigestObservation } from "./digestObservations";
import { counterpartyOf } from "./yearReview";
import { formatDate, monthTitle } from "./format";
import {
  comparableRanges,
  periodKey,
  periodRange,
  quarterLabel,
  quarterRange,
  shiftDays,
  shiftPeriod,
  spanDays,
  type DayRange,
} from "./period";

/** Короткий период — разбивка по дням: помесячно там была бы одна точка. */
export const DAILY_MAX_DAYS = 62;
/** Сколько строк в разделах «Куда ушли деньги». */
export const TOP_EXPENSE_CATEGORIES = 8;
export const TOP_INCOME_CATEGORIES = 5;
export const TOP_PAYEES = 8;
export const TOP_OPERATIONS = 8;
/** Подпись свёрнутого хвоста категорий. */
export const REST_LABEL = "Остальное";

export interface ReportTotals {
  income: number;
  expense: number;
  net: number;
  /** Норма сбережений: (доход − расход) / доход. Нет дохода — `null`. */
  rate: number | null;
  /** Операций (без переводов). */
  count: number;
}

export interface ReportBucket {
  /** «YYYY-MM» отчётного месяца или «YYYY-MM-DD» дня. */
  key: string;
  income: number;
  expense: number;
  net: number;
}

export interface ReportCategory {
  name: string;
  total: number;
  /** Доля от всех трат (или поступлений) периода, 0…1. */
  share: number;
  /** Сумма за прошлый период; `null` — сравнивать не с чем. */
  prev: number | null;
  color: string;
  /** Свёрнутый хвост мелких категорий. */
  rest?: boolean;
}

export interface ReportPayee {
  name: string;
  total: number;
  count: number;
}

export interface ReportOperation {
  id: string;
  date: string;
  payee: string;
  category: string;
  amount: number;
}

export interface PeriodReportModel {
  range: DayRange;
  /** Последний день с данными внутри периода — у идущего периода раньше `to`. */
  lastDay: string;
  /** Период ещё идёт: в нём есть будущие дни. */
  running: boolean;
  /** Прошлый сопоставимый период — тот, с которым сравниваем. */
  prevRange: DayRange | null;
  totals: ReportTotals;
  prevTotals: ReportTotals | null;
  bucket: "month" | "day";
  buckets: ReportBucket[];
  expenseCategories: ReportCategory[];
  incomeCategories: ReportCategory[];
  payees: ReportPayee[];
  operations: ReportOperation[];
  observations: DigestObservation[];
}

/** Операции, попавшие в отрезок (дни включительно). */
export function inRange(txs: readonly Transaction[], r: DayRange): Transaction[] {
  return txs.filter((t) => {
    const d = t.date.slice(0, 10);
    return d >= r.from && d <= r.to;
  });
}

function totalsOf(txs: Transaction[]): ReportTotals {
  const k = computeKPI(txs);
  return {
    income: k.income,
    expense: k.expense,
    net: k.net,
    rate: k.income > 0 ? (k.income - k.expense) / k.income : null,
    count: k.count,
  };
}

/**
 * Прошлый сопоставимый период для сравнения.
 *
 * Календарные год, квартал и месяц сравниваются с прошлыми такими же, отчётный
 * месяц — с прошлым отчётным (со своим первым днём). Скользящие окна и свои
 * даты — с отрезком той же длины прямо перед ними. «Всё время» сравнивать не
 * с чем.
 */
export function previousRange(
  preset: DatePreset,
  range: DayRange,
  monthYM: string | null,
  monthStartDay: number
): DayRange | null {
  if (preset === "all") return null;
  if (preset === "year") {
    const y = Number(range.from.slice(0, 4)) - 1;
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  if (preset === "quarter") return quarterRange(shiftPeriod(range.from.slice(0, 7), -3));
  if (preset === "month" && monthYM) return periodRange(shiftPeriod(monthYM, -1), 1);
  if (preset === "period" && monthYM) return periodRange(shiftPeriod(monthYM, -1), monthStartDay);
  const len = spanDays(range.from, range.to);
  if (len <= 0) return null;
  return { from: shiftDays(range.from, -len), to: shiftDays(range.from, -1) };
}

/** Ключи отчётных месяцев от `from` до `to` подряд, без пропусков. */
function monthKeys(from: string, to: string, monthStartDay: number): string[] {
  const first = periodKey(from, monthStartDay);
  const last = periodKey(to, monthStartDay);
  const out: string[] = [];
  for (let ym = first; ym <= last && out.length < 600; ym = shiftPeriod(ym, 1)) out.push(ym);
  return out;
}

function categories(
  now: Transaction[],
  prev: Transaction[] | null,
  kind: "expense" | "income",
  top: number,
  colorOf: (name: string) => string
): ReportCategory[] {
  const nodes = buildHierarchy(now, kind).filter((n) => n.total > 0);
  const sum = nodes.reduce((s, n) => s + n.total, 0);
  if (sum <= 0) return [];
  const prevBy = prev ? new Map(buildHierarchy(prev, kind).map((n) => [n.name, n.total])) : null;
  const head = nodes.slice(0, top).map<ReportCategory>((n) => ({
    name: n.name,
    total: n.total,
    share: n.total / sum,
    prev: prevBy ? prevBy.get(n.name) ?? 0 : null,
    color: colorOf(n.name),
  }));
  const tail = nodes.slice(top);
  if (tail.length > 0) {
    const total = tail.reduce((s, n) => s + n.total, 0);
    head.push({
      name: REST_LABEL,
      total,
      share: total / sum,
      prev: prevBy ? tail.reduce((s, n) => s + (prevBy.get(n.name) ?? 0), 0) : null,
      color: "#94a3b8",
      rest: true,
    });
  }
  return head;
}

/**
 * Собрать модель отчёта.
 *
 * `txs` — операции после всех фильтров, КРОМЕ периода: из них берутся и сам
 * период, и прошлый для сравнения. `range` — границы периода; у «Всего
 * времени» их задаёт вызывающий (от первой операции до последней).
 */
export function buildPeriodReport(input: {
  txs: readonly Transaction[];
  range: DayRange;
  prevRange: DayRange | null;
  /** Последняя операция всей истории — дальше неё данных нет. */
  maxDate: string;
  monthStartDay: number;
  /** Отчётный месяц: «Половины месяца» в наблюдениях только у него. */
  isMonth: boolean;
  colorOf: (category: string) => string;
}): PeriodReportModel {
  const { range, maxDate, monthStartDay, colorOf } = input;
  const running = !!maxDate && maxDate < range.to && maxDate >= range.from;
  const lastDay = running ? maxDate : range.to;
  // Идущий период сравниваем с тем же числом дней прошлого — «к этому дню».
  let prevRange = input.prevRange;
  if (prevRange) prevRange = comparableRanges(range, prevRange, maxDate, true).b;

  const now = inRange(input.txs, range);
  const prev = prevRange ? inRange(input.txs, prevRange) : null;

  const days = spanDays(range.from, lastDay);
  const daily = days > 0 && days <= DAILY_MAX_DAYS;
  let buckets: ReportBucket[];
  if (daily) {
    const by = new Map<string, ReportBucket>();
    for (let d = range.from; d <= lastDay; d = shiftDays(d, 1))
      by.set(d, { key: d, income: 0, expense: 0, net: 0 });
    for (const t of now) {
      const b = by.get(t.date.slice(0, 10));
      if (!b) continue;
      if (t.kind === "income") b.income += t.amountBase;
      else if (t.kind === "expense") b.expense += t.amountBase;
      else if (t.kind === "refund") b.expense -= t.amountBase;
    }
    buckets = [...by.values()].map((b) => ({ ...b, net: b.income - b.expense }));
  } else {
    const by = new Map(groupByMonth(now, { monthStartDay }).map((m) => [m.ym, m]));
    buckets = monthKeys(range.from, lastDay, monthStartDay).map((ym) => {
      const m = by.get(ym);
      return { key: ym, income: m?.income ?? 0, expense: m?.expense ?? 0, net: m?.net ?? 0 };
    });
  }

  // Расход по дням — основа «Наблюдений», как в «Дайджесте».
  const dayExpense = new Map<string, number>();
  for (const t of now) {
    const d = t.date.slice(0, 10);
    if (t.kind === "expense") dayExpense.set(d, (dayExpense.get(d) ?? 0) + t.amountBase);
    else if (t.kind === "refund") dayExpense.set(d, (dayExpense.get(d) ?? 0) - t.amountBase);
  }
  const allDays: { date: string; expense: number }[] = [];
  for (let d = range.from; d <= range.to && allDays.length < 4000; d = shiftDays(d, 1))
    allDays.push({ date: d, expense: dayExpense.get(d) ?? 0 });
  const observations = buildObservations([...input.txs], {
    period: "month",
    start: range.from,
    end: range.to,
    days: allDays,
    running: running ? { day: spanDays(range.from, lastDay), days: allDays.length } : undefined,
  }).filter((o) => o.id !== "halves" || input.isMonth);

  const payees = topPayees(now, "expense", TOP_PAYEES, true).map((p) => ({
    name: p.payee,
    total: p.total,
    count: p.count,
  }));
  const operations = topTransactions(now, "expense", TOP_OPERATIONS).map((t) => ({
    id: t.id,
    date: t.date.slice(0, 10),
    payee: counterpartyOf(t),
    category: t.categoryFull,
    amount: t.amountBase,
  }));

  return {
    range,
    lastDay,
    running,
    prevRange,
    totals: totalsOf(now),
    prevTotals: prev ? totalsOf(prev) : null,
    bucket: daily ? "day" : "month",
    buckets,
    expenseCategories: categories(now, prev, "expense", TOP_EXPENSE_CATEGORIES, colorOf),
    incomeCategories: categories(now, prev, "income", TOP_INCOME_CATEGORIES, colorOf),
    payees,
    operations,
    observations,
  };
}

/** Относительное изменение `now` к `prev`; `null` — не с чем сравнить. */
export function changeOf(now: number, prev: number | null | undefined): number | null {
  if (prev === null || prev === undefined || prev === 0) return null;
  return now / prev - 1;
}

/** «01.03.2026 — 31.03.2026». */
export function rangeText(r: DayRange): string {
  return r.from === r.to ? formatDate(r.from, "full") : `${formatDate(r.from, "full")} — ${formatDate(r.to, "full")}`;
}

/**
 * Название периода для обложки: «Октябрь 2026», «IV кв. 2026», «2026 год» —
 * или даты, если у периода нет короткого имени. Отчётный месяц со своим
 * первым днём называется по месяцу начала, как в Дзен-мани; даты — второй
 * строкой обложки.
 */
export function reportTitle(preset: DatePreset, range: DayRange, monthYM: string | null): string {
  if ((preset === "month" || preset === "period") && monthYM) return monthTitle(monthYM);
  if (preset === "quarter") return quarterLabel(range.from.slice(0, 7)).replace("кв.", "квартал");
  if (preset === "year") return `${range.from.slice(0, 4)} год`;
  if (preset === "all") return "Всё время";
  return rangeText(range);
}

/** Сколько строк помещается в таблицу «По месяцам» на листе. */
export const MONTH_TABLE_MAX = 13;

/**
 * Строки таблицы движения денег: отчётные месяцы, а если их больше
 * `MONTH_TABLE_MAX` — годы (у «Всего времени» месяцев бывают сотни). У
 * разбивки по дням таблицы нет: тридцать строк по дню ничего не добавят к
 * графику.
 */
export function tableRows(m: Pick<PeriodReportModel, "bucket" | "buckets">): { key: string; kind: "month" | "year"; income: number; expense: number; net: number }[] {
  if (m.bucket === "day") return [];
  if (m.buckets.length <= MONTH_TABLE_MAX) return m.buckets.map((b) => ({ ...b, kind: "month" as const }));
  const by = new Map<string, { key: string; kind: "year"; income: number; expense: number; net: number }>();
  for (const b of m.buckets) {
    const y = b.key.slice(0, 4);
    const row = by.get(y) ?? { key: y, kind: "year" as const, income: 0, expense: 0, net: 0 };
    row.income += b.income;
    row.expense += b.expense;
    row.net += b.net;
    by.set(y, row);
  }
  return [...by.values()];
}

/**
 * Разложить блоки по листам по порядку: блок, который не влезает в остаток
 * листа, целиком переходит на следующий. `room` — высота под блоки на листе,
 * `gap` — промежуток между соседними блоками. Блок выше листа встаёт на свой
 * лист один (лучше обрезанный край, чем потерянный блок).
 */
export function packSections(heights: readonly number[], room: number, gap: number): number[][] {
  const pages: number[][] = [];
  let cur: number[] = [];
  let used = 0;
  heights.forEach((h, i) => {
    const need = cur.length === 0 ? h : used + gap + h;
    if (cur.length > 0 && need > room) {
      pages.push(cur);
      cur = [i];
      used = h;
    } else {
      cur.push(i);
      used = need;
    }
  });
  if (cur.length > 0) pages.push(cur);
  return pages;
}
