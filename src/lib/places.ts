/**
 * Раздел «Контрагенты» — места, где тратятся деньги, и привычки по каждому.
 *
 * «Топ» отвечает на вопрос «кому больше всего заплатили за период». Здесь —
 * про отношения с местом: как часто туда ходите, растёт ли чек, когда были в
 * последний раз, какие места появились и куда ходить перестали. Поэтому
 * расчёты смотрят не только в выбранный период, но и в историю до него.
 *
 * Только расходы: у дохода «мест» нет, а работодатель в списке магазинов
 * читался бы странно. Возвраты гасят свою покупку в суммах, но визитом не
 * считаются и средний чек не занижают.
 */

import type { Transaction } from "../types";
import { counterpartyOf } from "./yearReview";
import { affectsExpense, expenseDelta } from "./txKindStyle";
import { periodKey, shiftDays, shiftPeriod, spanDays } from "./period";

/** Отрезок дат; `null` у границы — «без ограничения». */
export interface OpenRange {
  from: string | null;
  to: string | null;
}

/** Место в списке за выбранный период. */
export interface PlaceRow {
  name: string;
  /** Расход за период, возвраты вычтены. */
  total: number;
  /** Покупок за период — возвраты не в счёт. */
  visits: number;
  /** Средняя покупка за период. */
  avgCheck: number;
  /**
   * Средняя покупка за год до периода — с ней сравнивается нынешний чек.
   * `undefined`, когда покупок тогда было меньше {@link MIN_CHECK_SAMPLE}:
   * по одной-двум покупкам рост чека ничего не значит.
   */
  prevAvgCheck?: number;
  /** Самая крупная статья места за период. */
  category: string;
  /** Первая покупка за всю историю. */
  firstDate: string;
  /** Последняя покупка за всю историю. */
  lastDate: string;
  /** Первая покупка за всю историю пришлась на этот период. */
  isNew: boolean;
}

/** Место, куда раньше ходили регулярно, а в периоде — ни разу. */
export interface LostPlace {
  name: string;
  /** Покупок за полгода до периода. */
  visitsBefore: number;
  /** Сколько в среднем уходило в месяц за те полгода. */
  perMonthBefore: number;
  lastDate: string;
  category: string;
}

/** Месяц на графике места. */
export interface PlaceMonth {
  /** Отчётный период «ГГГГ-ММ». */
  ym: string;
  expense: number;
  visits: number;
}

/** Всё о месте за всю историю. */
export interface PlaceDossier {
  name: string;
  total: number;
  visits: number;
  avgCheck: number;
  firstDate: string;
  lastDate: string;
  /**
   * Обычно раз в столько дней — медиана промежутков между днями покупок.
   * `null`, пока дней с покупками меньше трёх.
   */
  everyDays: number | null;
  /** Любимый день недели, 0 — понедельник. `null`, пока покупок меньше пяти. */
  favWeekday: number | null;
  /** Доля покупок, пришедшихся на любимый день. */
  favWeekdayShare: number;
  /** Самые крупные статьи места, до трёх. */
  categories: { name: string; amount: number }[];
  /** Двенадцать отчётных периодов, последний — тот, где последняя операция истории. */
  months: PlaceMonth[];
  /** Самая крупная покупка. */
  biggest: { id: string; date: string; amount: number } | null;
}

/** Сколько покупок нужно в обоих отрезках, чтобы сравнивать средний чек. */
export const MIN_CHECK_SAMPLE = 3;

/** Сколько дней до периода смотрим, чтобы понять, что место было «своим». */
export const LOST_LOOKBACK_DAYS = 182;

/** Столько покупок за полгода — уже привычка, а не случайный заход. */
export const LOST_MIN_VISITS = 3;

/** Сколько мест показывать в списке «перестали ходить». */
const LOST_LIMIT = 10;

/** Расходная операция с привязанным местом — и как его зовут. */
function placeOf(t: Transaction): string | null {
  if (!affectsExpense(t.kind)) return null;
  const name = counterpartyOf(t);
  return name || null;
}

function inRange(date: string, r: OpenRange): boolean {
  return (!r.from || date >= r.from) && (!r.to || date <= r.to);
}

/** Самая крупная статья из словаря «статья → сумма». */
function topKey(m: Map<string, number>): string {
  let best = "";
  let max = -Infinity;
  for (const [k, v] of m) if (v > max) [best, max] = [k, v];
  return best;
}

/** Операции, сгруппированные по месту. Без места — не в счёт. */
export function groupByPlace(txs: readonly Transaction[]): Map<string, Transaction[]> {
  const out = new Map<string, Transaction[]>();
  for (const t of txs) {
    const name = placeOf(t);
    if (!name) continue;
    const list = out.get(name);
    if (list) list.push(t);
    else out.set(name, [t]);
  }
  return out;
}

/**
 * Места за период.
 *
 * `history` — те же операции, что на странице, но без ограничения по датам:
 * из неё берутся первая и последняя покупка и чек прошлого года. `range` —
 * период общего фильтра; без границ — вся история, и тогда «новых» мест нет.
 */
export function buildPlaceRows(history: readonly Transaction[], range: OpenRange): PlaceRow[] {
  const rows: PlaceRow[] = [];
  const prevFrom = range.from ? shiftDays(range.from, -365) : null;
  const prevTo = range.from ? shiftDays(range.from, -1) : null;
  for (const [name, list] of groupByPlace(history)) {
    let total = 0;
    let gross = 0;
    let visits = 0;
    let prevGross = 0;
    let prevVisits = 0;
    let firstDate = "";
    let lastDate = "";
    const byCat = new Map<string, number>();
    for (const t of list) {
      if (t.kind === "expense") {
        if (!firstDate || t.date < firstDate) firstDate = t.date;
        if (t.date > lastDate) lastDate = t.date;
      }
      if (inRange(t.date, range)) {
        total += expenseDelta(t);
        byCat.set(t.categoryFull, (byCat.get(t.categoryFull) ?? 0) + expenseDelta(t));
        if (t.kind === "expense") {
          gross += t.amountBase;
          visits++;
        }
      } else if (prevFrom && prevTo && t.kind === "expense" && t.date >= prevFrom && t.date <= prevTo) {
        prevGross += t.amountBase;
        prevVisits++;
      }
    }
    // Место, где за период были одни возвраты или всё вернули, — не трата.
    if (visits === 0 || total <= 0) continue;
    rows.push({
      name,
      total,
      visits,
      avgCheck: gross / visits,
      prevAvgCheck:
        visits >= MIN_CHECK_SAMPLE && prevVisits >= MIN_CHECK_SAMPLE ? prevGross / prevVisits : undefined,
      category: topKey(byCat),
      firstDate,
      lastDate,
      isNew: !!range.from && firstDate >= range.from,
    });
  }
  return rows.sort((a, b) => b.total - a.total);
}

/**
 * Куда перестали ходить: за полгода до периода — не меньше трёх покупок и
 * хотя бы в двух разных месяцах (одна неделя ремонта — не привычка), а с
 * начала периода и по его конец — ни одной.
 *
 * Пауза должна быть заметно длиннее обычной: место, куда ходите раз в месяц,
 * на десятый день периода ещё не «пропало». Поэтому с последней покупки до
 * конца периода (или до последней операции истории, если период ещё идёт)
 * должно пройти не меньше полутора месяцев и не меньше двух с половиной
 * обычных промежутков.
 */
export function findLostPlaces(
  history: readonly Transaction[],
  range: OpenRange,
  maxDate: string
): LostPlace[] {
  if (!range.from) return [];
  const lookFrom = shiftDays(range.from, -LOST_LOOKBACK_DAYS);
  const lookTo = shiftDays(range.from, -1);
  const end = range.to && range.to < maxDate ? range.to : maxDate;
  const out: LostPlace[] = [];
  for (const [name, list] of groupByPlace(history)) {
    let before = 0;
    let spent = 0;
    let after = false;
    let lastDate = "";
    const days: string[] = [];
    const months = new Set<string>();
    const byCat = new Map<string, number>();
    for (const t of list) {
      if (t.kind !== "expense") continue;
      if (t.date >= range.from && t.date <= end) {
        after = true;
        break;
      }
      if (t.date >= lookFrom && t.date <= lookTo) {
        before++;
        spent += t.amountBase;
        months.add(t.date.slice(0, 7));
        days.push(t.date);
        byCat.set(t.categoryFull, (byCat.get(t.categoryFull) ?? 0) + t.amountBase);
        if (t.date > lastDate) lastDate = t.date;
      }
    }
    if (after || before < LOST_MIN_VISITS || months.size < 2) continue;
    const interval = typicalGap(days) ?? LOST_LOOKBACK_DAYS / before;
    const silence = spanDays(lastDate, end) - 1;
    if (silence < Math.max(45, interval * 2.5)) continue;
    out.push({
      name,
      visitsBefore: before,
      perMonthBefore: spent / (LOST_LOOKBACK_DAYS / 30.4),
      lastDate,
      category: topKey(byCat),
    });
  }
  return out.sort((a, b) => b.perMonthBefore - a.perMonthBefore).slice(0, LOST_LIMIT);
}

/**
 * Обычный промежуток между днями покупок — медиана, а не среднее: один
 * отпуск без походов не должен растягивать привычку. `null`, пока дней с
 * покупками меньше трёх.
 */
function typicalGap(dates: readonly string[]): number | null {
  const days = [...new Set(dates)].sort();
  if (days.length < 3) return null;
  const gaps: number[] = [];
  for (let i = 1; i < days.length; i++) gaps.push(spanDays(days[i - 1], days[i]) - 1);
  return median(gaps);
}

/** День недели с понедельника: 0 — пн, 6 — вс. */
function weekdayMon(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Досье места за всю историю — для карточки справа от списка.
 *
 * `maxDate` — последняя операция всей истории: от неё отсчитываются двенадцать
 * месяцев графика, чтобы у всех мест ось была одна и та же и пустые месяцы
 * («перестали ходить») были видны как пустые, а не пропадали.
 */
export function buildPlaceDossier(
  history: readonly Transaction[],
  name: string,
  maxDate: string,
  monthStartDay: number = 1
): PlaceDossier | null {
  const list = history.filter((t) => placeOf(t) === name);
  const buys = list.filter((t) => t.kind === "expense");
  if (buys.length === 0) return null;

  const total = list.reduce((s, t) => s + expenseDelta(t), 0);
  const gross = buys.reduce((s, t) => s + t.amountBase, 0);
  const dates = buys.map((t) => t.date).sort();

  const gap = typicalGap(dates);
  const everyDays = gap == null ? null : Math.max(1, Math.round(gap));

  let favWeekday: number | null = null;
  let favWeekdayShare = 0;
  if (buys.length >= 5) {
    const counts = new Array(7).fill(0);
    for (const d of dates) counts[weekdayMon(d)]++;
    const max = Math.max(...counts);
    // День «любимый», только если он заметно чаще остальных: при равномерных
    // походах «чаще всего в среду» — случайность.
    if (max / buys.length >= 0.25 && counts.filter((c) => c === max).length === 1) {
      favWeekday = counts.indexOf(max);
      favWeekdayShare = max / buys.length;
    }
  }

  const byCat = new Map<string, number>();
  for (const t of list) byCat.set(t.categoryFull, (byCat.get(t.categoryFull) ?? 0) + expenseDelta(t));
  const categories = [...byCat.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([n, amount]) => ({ name: n, amount }));

  const last = periodKey(maxDate, monthStartDay);
  const months: PlaceMonth[] = [];
  const idx = new Map<string, PlaceMonth>();
  for (let k = 11; k >= 0; k--) {
    const m = { ym: shiftPeriod(last, -k), expense: 0, visits: 0 };
    months.push(m);
    idx.set(m.ym, m);
  }
  for (const t of list) {
    const m = idx.get(periodKey(t.date, monthStartDay));
    if (!m) continue;
    m.expense += expenseDelta(t);
    if (t.kind === "expense") m.visits++;
  }
  for (const m of months) if (m.expense < 0) m.expense = 0;

  let biggest: PlaceDossier["biggest"] = null;
  for (const t of buys) if (!biggest || t.amountBase > biggest.amount) biggest = { id: t.id, date: t.date, amount: t.amountBase };

  return {
    name,
    total,
    visits: buys.length,
    avgCheck: gross / buys.length,
    firstDate: dates[0],
    lastDate: dates[dates.length - 1],
    everyDays,
    favWeekday,
    favWeekdayShare,
    categories,
    months,
    biggest,
  };
}
