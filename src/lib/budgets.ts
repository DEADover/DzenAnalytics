import type { Transaction } from "../types";
import { affectsExpense, expenseDelta } from "./txKindStyle";
import { ALL_ACCOUNTS, budgetHits, type BudgetScope } from "./budgetScope";

/**
 * Budget model — "plan/fact by month", richer than the old flat
 * `Record<category, number>`.
 *
 * A {@link BudgetLine} carries a planned amount for a single *period*, a
 * recurrence, and a validity window. The per-month planned value is derived
 * (see {@link plannedFor}) and can be overridden for individual months
 * (`overrides`), which is how "tweak just this month" and "copy plan forward"
 * are expressed.
 */

/** Расходный или доходный бюджет — решает раздел и знак сравнения. */
export type BudgetKind = "expense" | "income";

/** Как часто действует плановая сумма. */
export type Recurrence = "monthly" | "quarterly" | "yearly" | "once";

export interface BudgetLine {
  id: string;
  category: string;
  /**
   * Под-категория (под-тег Дзена) или null = сам родительский тег. Бюджет
   * привязан РОВНО к одному тегу: строка с `subcategory: null` отражает план
   * самой родительской категории (траты, помеченные напрямую родителем, БЕЗ
   * детей), а под-тег получает собственную строку. Это зеркалит модель Дзен-
   * «Планов» (один план на тег) и делает синк обратимым. Поле необязательно
   * для обратной совместимости со старыми строками (читается как null).
   */
  subcategory?: string | null;
  kind: BudgetKind;
  /** Плановая сумма за ОДИН период (не за месяц для quarterly/yearly). */
  amount: number;
  recurrence: Recurrence;
  /** "YYYY-MM" — первый месяц действия. */
  startMonth: string;
  /** "YYYY-MM" — последний месяц действия, или null = бессрочно. */
  endMonth: string | null;
  /** Точечные правки конкретных месяцев: "YYYY-MM" → сумма. */
  overrides?: Record<string, number>;
  createdAt: string;
}

/**
 * Canonical key for a single budget CELL — one (kind, category, subcategory,
 * month). Used to mark a plan cell the user edited locally but hasn't pushed,
 * so a sync won't overwrite it with Zenmoney's (older) value. A plain «|»
 * separator keeps it debuggable; both the sync producer and the merge consumer
 * import THIS function, so the exact separator never matters as long as it's
 * shared.
 */
export function budgetCellKey(
  kind: string,
  category: string,
  subcategory: string | null,
  ym: string
): string {
  return [kind, category, subcategory ?? "", ym].join("|");
}

/** Months elapsed from `a` to `b` (both "YYYY-MM"); negative if b < a. */
export function monthDiff(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

/** Add `n` whole months to a "YYYY-MM" string. */
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  return `${ny}-${String(nm + 1).padStart(2, "0")}`;
}

/**
 * Does this line's recurrence "land" on month `ym`, ignoring overrides and the
 * window? quarterly/yearly land on a single month per period (anchored to
 * `startMonth`), matching how such payments actually hit (insurance once a
 * year, not 1/12 every month).
 */
function recurrenceHits(line: BudgetLine, ym: string): boolean {
  const d = monthDiff(line.startMonth, ym);
  if (d < 0) return false;
  switch (line.recurrence) {
    case "monthly":
      return true;
    case "quarterly":
      return d % 3 === 0;
    case "yearly":
      return d % 12 === 0;
    case "once":
      return d === 0;
  }
}

/**
 * Planned amount for a given month. Priority:
 *   1. explicit per-month override;
 *   2. the period amount, when `ym` is inside [startMonth, endMonth] AND the
 *      recurrence lands on that month;
 *   3. otherwise 0.
 */
export function plannedFor(line: BudgetLine, ym: string): number {
  const ov = line.overrides?.[ym];
  if (ov !== undefined) return ov;
  if (ym < line.startMonth) return 0;
  if (line.endMonth && ym > line.endMonth) return 0;
  return recurrenceHits(line, ym) ? line.amount : 0;
}

/**
 * Rough monthly-equivalent of a line, for "≈ per month" roll-ups. Spreads
 * quarterly/yearly across their cycle; a one-off contributes nothing to a
 * steady monthly figure.
 */
export function monthlyEquivalent(line: BudgetLine): number {
  switch (line.recurrence) {
    case "monthly":
      return line.amount;
    case "quarterly":
      return line.amount / 3;
    case "yearly":
      return line.amount / 12;
    case "once":
      return 0;
  }
}

/**
 * Actual amount for a line in month `ym`, derived from transactions.
 *   • expense line → Σ expenseDelta (expense minus refunds) over the tag;
 *   • income line  → Σ amountBase of income transactions over the tag.
 *
 * Подсчёт по тегам:
 *
 * • строка ПОД-КАТЕГОРИИ считает только свой под-тег;
 * • строка КАТЕГОРИИ считает всю категорию — и траты по самой категории, и
 *   траты по её под-категориям.
 *
 * Второе правило появилось не сразу. Раньше план на категорию видел только
 * операции, помеченные ею напрямую, — а человек, который не готов делить
 * «Медицину» на «Лекарства» и «Лечение», планирует именно категорию. Траты по
 * под-категории такой план не проедали: «Медицина» уезжала в «Без трат в этом
 * месяце», хотя деньги потрачены (issue #70).
 *
 * `ownSubs` — под-категории, у которых есть СВОЯ строка бюджета. Их суммы
 * категория не забирает, иначе одни и те же деньги посчитались бы дважды: и в
 * строке «Лекарства», и в итоге «Медицины».
 */
export function factFor(
  line: BudgetLine,
  txs: Transaction[],
  ym: string,
  scope: BudgetScope = ALL_ACCOUNTS,
  ownSubs?: ReadonlySet<string>
): number {
  const lineSub = line.subcategory ?? null;
  let sum = 0;
  for (const t of txs) {
    if (!t.date.startsWith(ym)) continue;
    for (const hit of budgetHits(t, scope)) {
      if (hit.kind !== line.kind) continue;
      if (hit.category !== line.category) continue;
      if (lineSub === null) {
        // Строка категории: берём и её собственные траты, и под-категории —
        // кроме тех, что бюджетируются отдельно.
        if (hit.subcategory !== null && ownSubs?.has(hit.subcategory)) continue;
      } else if (hit.subcategory !== lineSub) {
        continue;
      }
      sum += hit.amount;
    }
  }
  return sum;
}

/**
 * Под-категории, у которых есть собственная строка бюджета, по ключу
 * «тип + категория». Нужна `factFor`, чтобы строка категории не забирала себе
 * суммы, уже посчитанные отдельной строкой под-категории.
 */
export function ownSubsIndex(lines: BudgetLine[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const l of lines) {
    if (!l.subcategory) continue;
    const key = `${l.kind}\u0000${l.category}`;
    if (!out.has(key)) out.set(key, new Set());
    out.get(key)!.add(l.subcategory);
  }
  return out;
}

/** Под-категории со своим бюджетом для конкретной строки. */
export function ownSubsFor(
  index: Map<string, Set<string>>,
  line: BudgetLine
): Set<string> | undefined {
  return index.get(`${line.kind}\u0000${line.category}`);
}

/**
 * A rough «forecast» plan for a line that has NO manual budget — the median of
 * the tag's ACTUAL amount over the previous `lookback` months, rounded to the
 * nearest 100. Mirrors what Zenmoney shows as «из X» for tags you don't budget
 * manually (e.g. interest / cashback income). Returns 0 when there's no steady
 * history (median below 100) — so one-off amounts don't become a phantom plan.
 */
export function forecastFor(
  line: BudgetLine,
  txs: Transaction[],
  ym: string,
  lookback = 6,
  scope: BudgetScope = ALL_ACCOUNTS
): number {
  const vals: number[] = [];
  for (let i = 1; i <= lookback; i++)
    vals.push(factFor(line, txs, addMonths(ym, -i), scope));
  vals.sort((a, b) => a - b);
  const mid = Math.floor(vals.length / 2);
  const median =
    vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  const rounded = Math.round(median / 100) * 100;
  return rounded >= 100 ? rounded : 0;
}

/**
 * Состояние статьи по отношению факта к плану. У расхода и дохода логика
 * зеркальная: перебрать план по расходу — плохо, по доходу — ровно наоборот.
 * Одна функция на месячный вид и годовой свод, чтобы цвета не разъезжались.
 */
export type BudgetTone = "income" | "warn" | "expense";
export function budgetTone(ratio: number, isIncome: boolean): BudgetTone {
  if (isIncome) return ratio >= 1 ? "income" : ratio >= 0.8 ? "warn" : "expense";
  return ratio < 0.8 ? "income" : ratio <= 1 ? "warn" : "expense";
}

/** Days in the calendar month of a "YYYY-MM" string. */
export function daysInMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

/** One day on the cumulative cash-flow chart. Actual values are non-null up to
 *  «today», forecast values non-null from «today» on (they share the today point
 *  so the solid and dashed segments join). */
export interface CashflowPoint {
  day: number;
  income: number | null;
  expense: number | null;
  incomeF: number | null;
  expenseF: number | null;
}

export interface MonthCashflow {
  points: CashflowPoint[];
  /** Day-of-month treated as «today» (= actual/forecast split). */
  todayDay: number;
  days: number;
  factIncome: number;
  factExpense: number;
  /** Linear end-of-month projection (actual totals for a past month). */
  projIncome: number;
  projExpense: number;
}

/**
 * Daily CUMULATIVE income & expense for month `ym`, with a linear end-of-month
 * forecast — the data behind the Zen-style «План на день» / cash-flow widget.
 *
 * Actual cumulative lines run day 1 → today; from today on, each line continues
 * at its average daily pace so far (`cum/today`), which is the same simple
 * extrapolation as the per-row «прогноз». A past month is fully actual (no
 * forecast); a future month has neither.
 */
export function buildMonthCashflow(
  txs: Transaction[],
  ym: string,
  now = Date.now(),
  opts?: {
    plannedIncome?: number;
    plannedExpense?: number;
    /** Запланированные операции по дням месяца, 1-индексированные массивы. */
    plannedIncomeByDay?: number[];
    plannedExpenseByDay?: number[];
  }
): MonthCashflow {
  const days = daysInMonth(ym);
  const today = new Date(now);
  const curYm = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  // Split day: current month → today's date; past month → whole month is actual;
  // future month → nothing has happened yet.
  const todayDay = ym === curYm ? today.getDate() : ym < curYm ? days : 0;

  const incDelta = new Array(days + 1).fill(0);
  const expDelta = new Array(days + 1).fill(0);
  for (const t of txs) {
    if (!t.date.startsWith(ym)) continue;
    const d = Number(t.date.slice(8, 10));
    if (!(d >= 1 && d <= days)) continue;
    if (t.kind === "income") incDelta[d] += t.amountBase;
    else if (affectsExpense(t.kind)) expDelta[d] += expenseDelta(t);
  }

  const factIncome = cumulate(incDelta, todayDay);
  const factExpense = cumulate(expDelta, todayDay);
  const remaining = days - todayDay;
  const hasForecast = todayDay > 0 && remaining > 0;

  // Month-end targets. When a budget PLAN is supplied, project to it (Zen-style:
  // you'll receive/spend at least the planned amount) instead of extrapolating
  // the current daily pace. Pace extrapolation wildly overstates LUMPY income —
  // a salary that lands on day 1 would imply ~30× that by month-end (this was
  // the «свободные деньги 1.9M vs Дзен 141k» bug). Falls back to the pace
  // projection when no plan is given (dashboard / tests).
  const usePlan =
    hasForecast &&
    (opts?.plannedIncome != null || opts?.plannedExpense != null);
  let targetIncome: number;
  let targetExpense: number;
  if (usePlan) {
    targetIncome = Math.max(factIncome, opts?.plannedIncome ?? 0);
    targetExpense = Math.max(factExpense, opts?.plannedExpense ?? 0);
  } else if (hasForecast) {
    targetIncome = factIncome + (factIncome / todayDay) * remaining;
    targetExpense = factExpense + (factExpense / todayDay) * remaining;
  } else {
    targetIncome = factIncome;
    targetExpense = factExpense;
  }

  // Запланированные операции рисуются СТУПЕНЬКОЙ в свой день, а не размазываются
  // ровной линией до конца месяца. Зарплата 15-го — это событие с датой, и на
  // графике должно быть видно, когда именно деньги придут (issue #72). Остаток
  // плана, не покрытый конкретными операциями, по-прежнему идёт ровно.
  const futInc = futureByDay(opts?.plannedIncomeByDay, todayDay, days);
  const futExp = futureByDay(opts?.plannedExpenseByDay, todayDay, days);
  const futIncTotal = cumulate(futInc, days);
  const futExpTotal = cumulate(futExp, days);
  // Цель месяца не меньше, чем факт плюс уже назначенные операции: иначе
  // ступенька увела бы линию выше собственного прогноза.
  targetIncome = Math.max(targetIncome, factIncome + futIncTotal);
  targetExpense = Math.max(targetExpense, factExpense + futExpTotal);
  const smoothInc = Math.max(0, targetIncome - factIncome - futIncTotal);
  const smoothExp = Math.max(0, targetExpense - factExpense - futExpTotal);

  const points: CashflowPoint[] = [];
  let cumInc = 0;
  let cumExp = 0;
  let stepInc = 0;
  let stepExp = 0;
  for (let d = 1; d <= days; d++) {
    cumInc += incDelta[d];
    cumExp += expDelta[d];
    if (d < todayDay) {
      points.push({ day: d, income: cumInc, expense: cumExp, incomeF: null, expenseF: null });
    } else if (d === todayDay) {
      // The split day anchors BOTH segments so the dashed forecast joins the solid line.
      points.push({ day: d, income: cumInc, expense: cumExp, incomeF: cumInc, expenseF: cumExp });
    } else {
      stepInc += futInc[d];
      stepExp += futExp[d];
      const t = remaining > 0 ? (d - todayDay) / remaining : 0;
      points.push({
        day: d,
        income: null,
        expense: null,
        incomeF: factIncome + stepInc + smoothInc * t,
        expenseF: factExpense + stepExp + smoothExp * t,
      });
    }
  }

  return {
    points,
    todayDay,
    days,
    factIncome,
    factExpense,
    projIncome: targetIncome,
    projExpense: targetExpense,
  };
}

/**
 * Суммы запланированных операций по дням — только те, что ещё впереди.
 *
 * Операция, назначенная на уже прошедший день, но так и не проведённая, в
 * прогноз не идёт: она либо случилась и уже лежит в факте, либо не случилась, и
 * обещать её задним числом неправильно.
 */
function futureByDay(
  byDay: number[] | undefined,
  todayDay: number,
  days: number
): number[] {
  const out = new Array(days + 1).fill(0);
  if (!byDay) return out;
  for (let d = todayDay + 1; d <= days; d++) out[d] = byDay[d] ?? 0;
  return out;
}

/** Σ of `arr[1..n]` (the per-day delta arrays are 1-indexed). */
function cumulate(arr: number[], n: number): number {
  let s = 0;
  for (let i = 1; i <= n; i++) s += arr[i] ?? 0;
  return s;
}

/**
 * Migrate the legacy flat budgets (`Record<category, monthlyLimit>`) into the
 * new line model: every entry becomes an open-ended monthly expense line
 * starting at `startMonth` (default: the current month). Behaviour is
 * unchanged for existing users — a monthly expense limit on every month.
 */
export function migrateLegacyBudgets(
  legacy: Record<string, number> | null | undefined,
  startMonth: string,
  now = Date.now()
): BudgetLine[] {
  if (!legacy) return [];
  return Object.entries(legacy)
    .filter(([, amount]) => amount > 0)
    .map(([category, amount], i) => ({
      id: `mig-${now}-${i}`,
      category,
      subcategory: null,
      kind: "expense" as const,
      amount,
      recurrence: "monthly" as const,
      startMonth,
      endMonth: null,
      createdAt: new Date(now).toISOString(),
    }));
}
