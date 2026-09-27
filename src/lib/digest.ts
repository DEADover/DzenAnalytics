import type { Transaction } from "../types";
import { groupByCategory } from "./aggregations";
import { counterpartyOf } from "./yearReview";
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
  /** Доля дохода, что осталась: (доход − расход) / доход; 0 без дохода. */
  savingsRate: number;
  /** Расход по дням периода — для графика; дни без трат тоже есть, с нулём. */
  days: DigestDay[];
  /** Сколько дней периода прошли без единой траты. */
  noSpendDays: number;
  /** Самый дорогой день периода; `null`, если трат не было. */
  biggestDay: DigestDay | null;
  /** Где тратили больше всего — по получателям (бренду, если он есть). */
  topPayees: DigestPayee[];
  /** Получатели, которым в этом периоде заплатили впервые за всю историю. */
  newPayees: DigestPayee[];
  /**
   * Обычный такой же период — среднее за предыдущие (до шести) месяцев или
   * недель. Прошлый период бывает нетипичным, со средним сравнивать честнее.
   * `null` — предыдущих периодов нет.
   */
  typical: { income: number; expense: number; net: number; periods: number } | null;
}

export interface DigestDay {
  date: string;
  expense: number;
}

export interface DigestPayee {
  name: string;
  expense: number;
  count: number;
}

/** Сколько предыдущих периодов берём в «обычное». */
const TYPICAL_PERIODS = 6;
/** Сколько строк в «Где тратили» и «Новое». */
const PAYEES_TOP = 5;

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
  // Родительный падеж: «3 мая», а не «3 май». Остальные — сокращения.
  "янв","фев","мар","апр","мая","июн","июл","авг","сен","окт","ноя","дек",
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
  endIso: string,
  sorted = false
): Transaction[] {
  if (!sorted) return transactions.filter((t) => t.date >= startIso && t.date <= endIso);
  // По отсортированному массиву отрезок вырезается двоичным поиском. Разница
  // видна на ленте целиком: периодов там три с половиной сотни, и каждый гнал
  // по всей истории дважды — свой отрезок и предыдущий.
  return transactions.slice(lowerBound(transactions, startIso), upperBound(transactions, endIso));
}

/** Первый индекс, где дата не меньше `iso`. */
function lowerBound(a: Transaction[], iso: string): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid].date < iso) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Первый индекс, где дата больше `iso`. Граница включительная, как у фильтра. */
function upperBound(a: Transaction[], iso: string): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid].date <= iso) lo = mid + 1;
    else hi = mid;
  }
  return lo;
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

/** Все дни отрезка по порядку, «ГГГГ-ММ-ДД». */
function daysBetween(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  const d = ymdToLocalDate(startIso);
  const end = ymdToLocalDate(endIso);
  while (d <= end) {
    out.push(ymdLocal(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/**
 * Первая операция у каждого получателя — чтобы найти «новых». Считается один
 * раз на всю историю: по периоду его не восстановить.
 */
export function firstSeenByPayee(transactions: Transaction[]): Map<string, string> {
  const first = new Map<string, string>();
  for (const t of transactions) {
    const name = counterpartyOf(t);
    if (!name || typeof t.date !== "string") continue;
    const seen = first.get(name);
    if (!seen || t.date < seen) first.set(name, t.date);
  }
  return first;
}

/** Всё, что считается по операциям самого периода. */
function periodDetails(
  cur: Transaction[],
  startIso: string,
  endIso: string,
  firstSeen: Map<string, string>
) {
  const byDay = new Map<string, number>();
  const payees = new Map<string, DigestPayee>();
  for (const t of cur) {
    if (t.kind !== "expense" && t.kind !== "refund") continue;
    const d = expenseDelta(t);
    const day = t.date.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + d);
    const name = counterpartyOf(t);
    if (!name) continue;
    const p = payees.get(name) ?? { name, expense: 0, count: 0 };
    p.expense += d;
    if (t.kind === "expense") p.count++;
    payees.set(name, p);
  }
  const days = daysBetween(startIso, endIso).map((date) => ({
    date,
    expense: Math.max(0, byDay.get(date) ?? 0),
  }));
  const biggestDay = days.reduce<DigestDay | null>(
    (best, d) => (d.expense > 0 && (!best || d.expense > best.expense) ? d : best),
    null
  );
  const spent = [...payees.values()].filter((p) => p.expense > 0);
  return {
    days,
    noSpendDays: days.filter((d) => d.expense <= 0).length,
    biggestDay,
    topPayees: [...spent].sort((a, b) => b.expense - a.expense).slice(0, PAYEES_TOP),
    newPayees: spent
      .filter((p) => (firstSeen.get(p.name) ?? "") >= startIso)
      .sort((a, b) => b.expense - a.expense)
      .slice(0, PAYEES_TOP),
  };
}

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
  end: Date,
  /** Массив уже отсортирован по дате — тогда отрезок берётся двоичным поиском. */
  sorted = false,
  /** Первые операции получателей — считается один раз на всю ленту. */
  firstSeen?: Map<string, string>
): DigestEntry | null {
  const startIso = ymdLocal(start);
  const endIso = ymdLocal(end);
  const cur = txsInRange(transactions, startIso, endIso, sorted);
  if (cur.length === 0) return null;

  // Previous week
  const prevStart = new Date(start);
  prevStart.setDate(prevStart.getDate() - 7);
  const prevEnd = new Date(end);
  prevEnd.setDate(prevEnd.getDate() - 7);
  const prev = txsInRange(transactions, ymdLocal(prevStart), ymdLocal(prevEnd), sorted);

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
    savingsRate: curAgg.income > 0 ? curAgg.net / curAgg.income : 0,
    ...periodDetails(cur, startIso, endIso, firstSeen ?? firstSeenByPayee(transactions)),
    typical: null,
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
  end: Date,
  /** Массив уже отсортирован по дате — тогда отрезок берётся двоичным поиском. */
  sorted = false,
  /** Первые операции получателей — считается один раз на всю ленту. */
  firstSeen?: Map<string, string>
): DigestEntry | null {
  const cur = txsInRange(transactions, ymdLocal(start), ymdLocal(end), sorted);
  // Месяца без операций для одиночного вызова нет: карточке «прошлый месяц» на
  // Главной нечего показывать. В ленте это решается иначе — см. monthEntry.
  if (cur.length === 0) return null;
  return monthEntry(transactions, start, end, sorted, firstSeen);
}

/**
 * Месячная сводка БЕЗ проверки на пустоту.
 *
 * Пустой месяц внутри истории — это факт, а не отсутствие данных: «в июле не
 * было ни одной операции» надо показать, а не молча пропустить. Пропущенный
 * месяц читается как поломка — именно так и выглядело, когда лента обрывалась
 * на июне при данных до августа (issue #65).
 */
function monthEntry(
  transactions: Transaction[],
  start: Date,
  end: Date,
  sorted: boolean,
  firstSeen?: Map<string, string>
): DigestEntry {
  const startIso = ymdLocal(start);
  const endIso = ymdLocal(end);
  const cur = txsInRange(transactions, startIso, endIso, sorted);

  const prevStart = new Date(start.getFullYear(), start.getMonth() - 1, 1);
  const prevEnd = new Date(start.getFullYear(), start.getMonth(), 0);
  const prev = txsInRange(transactions, ymdLocal(prevStart), ymdLocal(prevEnd), sorted);

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
    savingsRate: curAgg.income > 0 ? curAgg.net / curAgg.income : 0,
    ...periodDetails(cur, startIso, endIso, firstSeen ?? firstSeenByPayee(transactions)),
    typical: null,
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

  // Записи с негодной датой отбрасываем сразу: по ним нельзя ни отсортировать
  // массив, ни искать в нём. Сравнение с `undefined` всегда ложно, поэтому одна
  // такая запись способна испортить порядок, а за ним и двоичный поиск.
  const byDate = transactions
    .filter((t) => typeof t.date === "string" && t.date.length >= 10)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (byDate.length === 0) return [];

  // Границы истории берём из уже отсортированного массива — с датами из него же
  // работают и все отрезки ниже.
  const minD = ymdToLocalDate(byDate[0].date);
  const firstSeen = firstSeenByPayee(byDate);

  const out: DigestEntry[] = [];

  // Месяцы: от первого месяца с данными до последнего ЗАВЕРШЁННОГО.
  //
  // Верхнюю границу больше НЕ задаёт дата последней операции. Это была
  // единственная причина, по которой лента месяцев могла оборваться раньше
  // ленты недель: у недель такой границы нет, они идут от сегодняшнего
  // понедельника назад. Стоило чему-нибудь исказить «дату последней операции» —
  // и месяцы кончались там, где недели показывали данные (issue #65).
  //
  // Месяц без единой операции в ленту не идёт. Короткое время было наоборот —
  // я показывал такие месяцы с нулями, чтобы список не обрывался «в никуда»,
  // когда в середине истории провал. Повод отпал: пропажа месяца, ради которой
  // это делалось, оказалась ошибкой перебора выше (сдвиг переводов часов), а
  // побочный эффект остался — одна случайная операция многолетней давности
  // растягивала ленту на сотни строк «0,00 ₽» (issue #65).
  const monthIndex = (y: number, m: number) => y * 12 + m;
  const lastIndex = monthIndex(today.getFullYear(), today.getMonth()) - 1;
  const startIndex = monthIndex(minD.getFullYear(), minD.getMonth());
  for (let i = startIndex; i <= lastIndex; i++) {
    const y = Math.floor(i / 12);
    const mo = i % 12;
    const entry = buildMonthDigest(byDate, new Date(y, mo, 1), new Date(y, mo + 1, 0), true, firstSeen);
    if (entry) out.push(entry);
  }

  // Недели: все завершённые, до первой недели с данными — так же, как месяцы.
  //
  // Раньше здесь стоял предел в 26 недель, ничем не объявленный. На истории в
  // пару лет получалась нелепица: месяцев тридцать с лишним, а недель — двадцать
  // шесть, и полгода назад лента просто обрывалась. Цикл и так останавливается
  // на первой неделе без данных, предел был лишним.
  const thisMonday = startOfMondayWeek(today);
  // Страховка от зацикливания на битой дате: сто лет недель — заведомо больше
  // любой реальной истории.
  for (let i = 1; i <= 5200; i++) {
    const wStart = new Date(thisMonday);
    wStart.setDate(wStart.getDate() - 7 * i);
    const wEnd = new Date(wStart);
    wEnd.setDate(wEnd.getDate() + 6);
    if (wEnd < minD) break;
    const entry = buildWeekDigest(byDate, wStart, wEnd, true, firstSeen);
    if (entry) out.push(entry);
  }

  // Sort newest first.
  out.sort((a, b) => b.end.localeCompare(a.end));
  attachTypical(out.filter((e) => e.period === "month"));
  attachTypical(out.filter((e) => e.period === "week"));
  return out;
}

/**
 * «Обычный» период — среднее за предыдущие (до шести) периоды того же вида.
 * Список идёт от свежего к старому, поэтому предыдущие — дальше по списку.
 */
function attachTypical(entries: DigestEntry[]): void {
  entries.forEach((e, i) => {
    const prev = entries.slice(i + 1, i + 1 + TYPICAL_PERIODS);
    if (prev.length === 0) return;
    const avg = (f: (x: DigestEntry) => number) => prev.reduce((s, x) => s + f(x), 0) / prev.length;
    e.typical = {
      income: avg((x) => x.income),
      expense: avg((x) => x.expense),
      net: avg((x) => x.net),
      periods: prev.length,
    };
  });
}

const MONTHS_GEN = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

/**
 * «Август 2026» или «неделю 14–20 сентября 2026» — для заголовка «Главное за …».
 * У недели на стыке месяцев или лет — обе даты целиком.
 */
export function periodTitle(entry: Pick<DigestEntry, "period" | "label" | "start" | "end">): string {
  if (entry.period === "month") return entry.label;
  const [y1, m1, d1] = entry.start.split("-").map(Number);
  const [y2, m2, d2] = entry.end.split("-").map(Number);
  if (y1 !== y2) return `неделю ${d1} ${MONTHS_GEN[m1 - 1]} ${y1} – ${d2} ${MONTHS_GEN[m2 - 1]} ${y2}`;
  if (m1 !== m2) return `неделю ${d1} ${MONTHS_GEN[m1 - 1]} – ${d2} ${MONTHS_GEN[m2 - 1]} ${y2}`;
  return `неделю ${d1}–${d2} ${MONTHS_GEN[m2 - 1]} ${y2}`;
}
