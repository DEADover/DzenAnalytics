import type { Transaction } from "../types";
import { groupByCategory } from "./aggregations";
import { expenseDelta } from "./txKindStyle";

export type DigestPeriod = "week" | "month";

export interface DigestCategoryDelta {
  category: string;
  current: number;
  previous: number;
  delta: number;       // relative change, e.g. +0.25 = +25%
}

export interface DigestEntry {
  id: string;          // unique key like "week-2026-W19" or "month-2026-04"
  period: DigestPeriod;
  start: string;       // ISO date (inclusive)
  end: string;         // ISO date (inclusive)
  label: string;       // human-readable, e.g. "Неделя 18-24 апр" / "Апрель 2026"
  generatedAt: string;
  // Metrics
  income: number;
  expense: number;
  net: number;
  txCount: number;
  // Comparison vs previous comparable period
  prevIncome: number;
  prevExpense: number;
  prevNet: number;
  incomeDelta: number;     // relative
  expenseDelta: number;
  // Top categories where spending changed the most (absolute jump)
  movers: DigestCategoryDelta[];
  // Biggest transactions in the period
  topTransactions: Transaction[];
}

const RU_MONTHS = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

const RU_MONTHS_SHORT = [
  "янв","фев","мар","апр","май","июн","июл","авг","сен","окт","ноя","дек",
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function relDelta(cur: number, prev: number): number {
  if (Math.abs(prev) < 0.01) return 0;
  return (cur - prev) / Math.abs(prev);
}

// ─── period helpers (ISO weeks, Mon-Sun) ──────────────────────────────────────

function startOfMondayWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7; // 0=Mon..6=Sun
  d.setDate(d.getDate() - day);
  return d;
}

function isoWeekKey(date: Date): string {
  // ISO 8601 week numbering
  const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${pad2(week)}`;
}

function weekLabel(start: Date, end: Date): string {
  const sameMonth = start.getMonth() === end.getMonth();
  const a = `${start.getDate()}${sameMonth ? "" : " " + RU_MONTHS_SHORT[start.getMonth()]}`;
  const b = `${end.getDate()} ${RU_MONTHS_SHORT[end.getMonth()]}`;
  return `Неделя ${a}–${b}`;
}

// ─── filter txs in inclusive range ────────────────────────────────────────────

function txsInRange(
  transactions: Transaction[],
  startIso: string,
  endIso: string
): Transaction[] {
  return transactions.filter((t) => t.date >= startIso && t.date <= endIso);
}

function aggregate(txs: Transaction[]): {
  income: number;
  expense: number;
  net: number;
  txCount: number;
} {
  let income = 0;
  let expense = 0;
  let txCount = 0;
  for (const t of txs) {
    if (t.kind === "transfer") continue;
    txCount++;
    if (t.kind === "income") income += t.amountBase;
    // `expenseDelta` returns +amount for expense and -amount for
    // refund, so refunds correctly net out of the period's expense
    // total instead of inflating it (which is what the old
    // `else expense += amount` branch did).
    else expense += expenseDelta(t);
  }
  return { income, expense, net: income - expense, txCount };
}

function categoryMovers(
  cur: Transaction[],
  prev: Transaction[],
  topN = 5
): DigestCategoryDelta[] {
  const curCats = groupByCategory(cur);
  const prevCats = groupByCategory(prev);
  const prevMap = new Map(prevCats.map((c) => [c.category, c.expense]));

  const out: DigestCategoryDelta[] = curCats
    .filter((c) => c.expense > 0)
    .map((c) => ({
      category: c.category,
      current: c.expense,
      previous: prevMap.get(c.category) || 0,
      delta: relDelta(c.expense, prevMap.get(c.category) || 0),
    }));

  // Rank by absolute change in money to surface meaningful movers.
  out.sort(
    (a, b) =>
      Math.abs(b.current - b.previous) - Math.abs(a.current - a.previous)
  );
  return out.slice(0, topN);
}

// ─── public API ───────────────────────────────────────────────────────────────

export function lastCompleteWeekDigest(
  transactions: Transaction[],
  today = new Date()
): DigestEntry | null {
  // "Last complete week" = the Mon..Sun week before the current Monday.
  const thisMonday = startOfMondayWeek(today);
  const lastSunday = new Date(thisMonday);
  lastSunday.setDate(lastSunday.getDate() - 1);
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(lastMonday.getDate() - 7);
  return buildWeekDigest(transactions, lastMonday, lastSunday);
}

export function buildWeekDigest(
  transactions: Transaction[],
  start: Date,
  end: Date
): DigestEntry | null {
  const startIso = ymdLocal(start);
  const endIso = ymdLocal(end);
  const cur = txsInRange(transactions, startIso, endIso);
  if (cur.length === 0) return null;

  // Previous week
  const prevStart = new Date(start);
  prevStart.setDate(prevStart.getDate() - 7);
  const prevEnd = new Date(end);
  prevEnd.setDate(prevEnd.getDate() - 7);
  const prev = txsInRange(transactions, ymdLocal(prevStart), ymdLocal(prevEnd));

  const curAgg = aggregate(cur);
  const prevAgg = aggregate(prev);

  const top = [...cur]
    .filter((t) => t.kind === "expense")
    .sort((a, b) => b.amountBase - a.amountBase)
    .slice(0, 5);

  return {
    id: `week-${isoWeekKey(start)}`,
    period: "week",
    start: startIso,
    end: endIso,
    label: weekLabel(start, end),
    generatedAt: new Date().toISOString(),
    income: curAgg.income,
    expense: curAgg.expense,
    net: curAgg.net,
    txCount: curAgg.txCount,
    prevIncome: prevAgg.income,
    prevExpense: prevAgg.expense,
    prevNet: prevAgg.net,
    incomeDelta: relDelta(curAgg.income, prevAgg.income),
    expenseDelta: relDelta(curAgg.expense, prevAgg.expense),
    movers: categoryMovers(cur, prev, 5),
    topTransactions: top,
  };
}

export function lastCompleteMonthDigest(
  transactions: Transaction[],
  today = new Date()
): DigestEntry | null {
  // Last calendar month (the one fully past).
  const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const end = new Date(today.getFullYear(), today.getMonth(), 0);
  return buildMonthDigest(transactions, start, end);
}

export function buildMonthDigest(
  transactions: Transaction[],
  start: Date,
  end: Date
): DigestEntry | null {
  const startIso = ymdLocal(start);
  const endIso = ymdLocal(end);
  const cur = txsInRange(transactions, startIso, endIso);
  if (cur.length === 0) return null;

  const prevStart = new Date(start.getFullYear(), start.getMonth() - 1, 1);
  const prevEnd = new Date(start.getFullYear(), start.getMonth(), 0);
  const prev = txsInRange(transactions, ymdLocal(prevStart), ymdLocal(prevEnd));

  const curAgg = aggregate(cur);
  const prevAgg = aggregate(prev);

  const top = [...cur]
    .filter((t) => t.kind === "expense")
    .sort((a, b) => b.amountBase - a.amountBase)
    .slice(0, 5);

  return {
    id: `month-${start.getFullYear()}-${pad2(start.getMonth() + 1)}`,
    period: "month",
    start: startIso,
    end: endIso,
    label: `${RU_MONTHS[start.getMonth()]} ${start.getFullYear()}`,
    generatedAt: new Date().toISOString(),
    income: curAgg.income,
    expense: curAgg.expense,
    net: curAgg.net,
    txCount: curAgg.txCount,
    prevIncome: prevAgg.income,
    prevExpense: prevAgg.expense,
    prevNet: prevAgg.net,
    incomeDelta: relDelta(curAgg.income, prevAgg.income),
    expenseDelta: relDelta(curAgg.expense, prevAgg.expense),
    movers: categoryMovers(cur, prev, 5),
    topTransactions: top,
  };
}

/** «ГГГГ-ММ-ДД» → полночь ЭТОГО дня по местному времени. */
function ymdToLocalDate(ymd: string): Date {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/**
 * Build a history of all completed weeks and months observed in the data.
 *
 * `today` вынесен в параметр, чтобы поведение на границе месяца можно было
 * проверить тестом, а не ждать первого числа.
 */
export function buildDigestHistory(
  transactions: Transaction[],
  today = new Date()
): DigestEntry[] {
  if (transactions.length === 0) return [];

  // Find data range
  let minDate = transactions[0].date;
  let maxDate = transactions[0].date;
  for (const t of transactions) {
    if (t.date < minDate) minDate = t.date;
    if (t.date > maxDate) maxDate = t.date;
  }
  // Разбираем «ГГГГ-ММ-ДД» по частям, а не через `new Date(строка)`: та читает
  // дату как UTC, а весь остальной счёт здесь ведётся в местном времени. К
  // западу от Гринвича из-за этого последний месяц с данными мог выпасть из
  // свода целиком — граница уезжала на день назад.
  const minD = ymdToLocalDate(minDate);
  const maxD = ymdToLocalDate(maxDate);

  const out: DigestEntry[] = [];

  // Months: every full month from minD's month to maxD's month minus 1 (we exclude current incomplete).
  const lastFullMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const startMonth = new Date(minD.getFullYear(), minD.getMonth(), 1);
  for (
    let m = new Date(startMonth);
    m <= lastFullMonth && m <= maxD;
    m.setMonth(m.getMonth() + 1)
  ) {
    const start = new Date(m.getFullYear(), m.getMonth(), 1);
    const end = new Date(m.getFullYear(), m.getMonth() + 1, 0);
    const entry = buildMonthDigest(transactions, start, end);
    if (entry) out.push(entry);
  }

  // Weeks: last 26 weeks before this Monday.
  const thisMonday = startOfMondayWeek(today);
  for (let i = 1; i <= 26; i++) {
    const wStart = new Date(thisMonday);
    wStart.setDate(wStart.getDate() - 7 * i);
    const wEnd = new Date(wStart);
    wEnd.setDate(wEnd.getDate() + 6);
    if (wEnd < minD) break;
    const entry = buildWeekDigest(transactions, wStart, wEnd);
    if (entry) out.push(entry);
  }

  // Sort newest first.
  return out.sort((a, b) => b.end.localeCompare(a.end));
}
