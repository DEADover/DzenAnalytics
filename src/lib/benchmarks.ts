/**
 * «Ориентиры» в «Финансовом здоровье» (#134): правила, с которыми сверяют
 * бюджет, — доля жилья, платежей по кредитам и вложений в доходе, срок
 * удвоения вложений. На общую оценку не влияют.
 *
 * Здесь только расчёт; настройки — `useBenchmarksStore`, сборка из данных
 * сервиса — `useBenchmarks`.
 */
import type { Transaction } from "../types";
import { completeMonths, groupByMonth } from "./aggregations";
import { txInKey, txOutKey } from "./accountKey";
import { periodKey } from "./period";
import { expenseDelta } from "./txKindStyle";
import { displayPayee } from "./format";

export interface BenchmarkSettings {
  housingOn: boolean;
  /** Категории жилья — листья, как в отборе по категориям (`categoryFull`). */
  housingCategories: string[];
  /**
   * Контрагенты жилья (#138) — имена, как в ленте. Нужны, когда жильё лежит в
   * общей категории («Счета») и различается только получателем: энергосбыт,
   * управляющая компания. Расход идёт в карточку, если подошла категория ИЛИ
   * контрагент.
   */
  housingPayees: string[];
  /** Порог, % дохода. */
  housingLimit: number;

  debtOn: boolean;
  /** Счета кредитов: платёж — перевод на такой счёт. `null` — все счета-кредиты. */
  debtAccounts: string[] | null;
  /** Категории, которыми платежи по кредитам записаны как расход. */
  debtCategories: string[];
  /** Контрагенты, платежи которым — платежи по кредитам. */
  debtPayees: string[];
  debtLimit: number;

  /** «Доля вложений в доходе». */
  investOn: boolean;
  /** Цель, % дохода: вкладывать не меньше. */
  investTarget: number;

  doublingOn: boolean;
  /** Счета инвестиций: вложение — перевод на такой счёт. */
  investAccounts: string[];
  /** Категории, которыми вложения записаны как расход. */
  investCategories: string[];
  /** Контрагенты, платежи которым — вложения. */
  investPayees: string[];
  /** Ожидаемая доходность, % годовых. */
  investRate: number;

  /** «Рост расходов к доходам»: настроек нет, только выключатель. */
  growthOn: boolean;

  /** «Подписки в доходе». */
  recurringOn: boolean;
  recurringLimit: number;

  /** Цель по подушке безопасности, месяцев расходов. В отличие от ориентиров,
   *  входит в общую оценку: подушка считается к этой цели. */
  cushionTarget: CushionTarget;
}

export const CUSHION_TARGETS = [3, 6, 12] as const;
export type CushionTarget = (typeof CUSHION_TARGETS)[number];

export const DEFAULT_BENCHMARKS: BenchmarkSettings = {
  housingOn: true,
  housingCategories: [],
  housingPayees: [],
  housingLimit: 33,
  debtOn: true,
  debtAccounts: null,
  debtCategories: [],
  debtPayees: [],
  debtLimit: 30,
  investOn: true,
  investTarget: 10,
  doublingOn: true,
  investAccounts: [],
  investCategories: [],
  investPayees: [],
  investRate: 12,
  growthOn: true,
  recurringOn: true,
  recurringLimit: 10,
  cushionTarget: 6,
};

const strings = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.every((x) => typeof x === "string") ? [...v] : undefined;
const num = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined;
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);

/** Сохранённое или пришедшее с другого устройства — в настройки; чужое и битое
 *  заменяется значением по умолчанию. */
export function parseBenchmarks(raw: unknown): BenchmarkSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_BENCHMARKS;
  return {
    housingOn: bool(r.housingOn) ?? d.housingOn,
    housingCategories: strings(r.housingCategories) ?? d.housingCategories,
    housingPayees: strings(r.housingPayees) ?? d.housingPayees,
    housingLimit: num(r.housingLimit, 5, 80) ?? d.housingLimit,
    debtOn: bool(r.debtOn) ?? d.debtOn,
    debtAccounts: r.debtAccounts === null ? null : (strings(r.debtAccounts) ?? d.debtAccounts),
    debtCategories: strings(r.debtCategories) ?? d.debtCategories,
    debtPayees: strings(r.debtPayees) ?? d.debtPayees,
    debtLimit: num(r.debtLimit, 5, 80) ?? d.debtLimit,
    investOn: bool(r.investOn) ?? d.investOn,
    investTarget: num(r.investTarget, 1, 80) ?? d.investTarget,
    doublingOn: bool(r.doublingOn) ?? d.doublingOn,
    investAccounts: strings(r.investAccounts) ?? d.investAccounts,
    investCategories: strings(r.investCategories) ?? d.investCategories,
    investPayees: strings(r.investPayees) ?? d.investPayees,
    investRate: num(r.investRate, 1, 40) ?? d.investRate,
    growthOn: bool(r.growthOn) ?? d.growthOn,
    recurringOn: bool(r.recurringOn) ?? d.recurringOn,
    recurringLimit: num(r.recurringLimit, 5, 80) ?? d.recurringLimit,
    cushionTarget: CUSHION_TARGETS.find((t) => t === r.cushionTarget) ?? d.cushionTarget,
  };
}

/** Сколько месяцев берём в расчёт. */
export const BENCHMARK_MONTHS = 12;

export interface BenchmarkWindow {
  /** Отчётные месяцы расчёта, по возрастанию. */
  yms: string[];
  /** Доход по месяцам. */
  income: Map<string, number>;
}

/**
 * Последние 12 завершённых отчётных месяцев. Идущий месяц не берём: зарплата
 * в нём могла ещё не прийти, а аренда уже уйти — доля вышла бы случайной.
 * Завершённых нет вовсе (первый месяц истории) — считаем по идущему.
 */
export function benchmarkWindow(
  analyticsTx: Transaction[],
  monthStartDay: number,
  today: string
): BenchmarkWindow {
  const picked = completeMonths(groupByMonth(analyticsTx, { monthStartDay }), monthStartDay, today).slice(
    -BENCHMARK_MONTHS
  );
  return { yms: picked.map((m) => m.ym), income: new Map(picked.map((m) => [m.ym, m.income])) };
}

/**
 * Расход по категориям и контрагентам за месяцы окна; возвраты вычитаются.
 * Операция идёт в счёт, если подошла её категория ИЛИ контрагент (#138), — и
 * считается один раз, даже когда подошло и то и другое.
 */
export function categoryFlow(
  analyticsTx: Transaction[],
  categories: ReadonlySet<string>,
  window: BenchmarkWindow,
  monthStartDay: number,
  /** Имена контрагентов, как в ленте (`displayPayee`). */
  payees: ReadonlySet<string> = new Set()
): Map<string, number> {
  const out = new Map(window.yms.map((ym) => [ym, 0]));
  if (categories.size === 0 && payees.size === 0) return out;
  for (const t of analyticsTx) {
    if (!categories.has(t.categoryFull) && !(payees.size > 0 && payees.has(displayPayee(t)))) continue;
    const d = expenseDelta(t);
    if (d === 0) continue;
    const ym = periodKey(t.date, monthStartDay);
    if (out.has(ym)) out.set(ym, out.get(ym)! + d);
  }
  return out;
}

/**
 * Переводы на счета набора с остальных счетов. `net` — за вычетом переводов
 * обратно: вложения минус изъятия. Платежам по кредиту вычет не нужен: деньги,
 * ушедшие с кредитного счёта, — новый заём, а не отрицательный платёж.
 */
export function accountInflow(
  transactions: Transaction[],
  accounts: ReadonlySet<string>,
  window: BenchmarkWindow,
  monthStartDay: number,
  net: boolean
): Map<string, number> {
  const out = new Map(window.yms.map((ym) => [ym, 0]));
  if (accounts.size === 0) return out;
  for (const t of transactions) {
    if (t.kind !== "transfer") continue;
    const into = accounts.has(txInKey(t));
    const from = accounts.has(txOutKey(t));
    if (into === from) continue; // мимо набора или внутри него
    if (from && !net) continue;
    const ym = periodKey(t.date, monthStartDay);
    if (out.has(ym)) out.set(ym, out.get(ym)! + (into ? t.amountBase : -t.amountBase));
  }
  return out;
}

/** Сумма двух рядов по месяцам. */
export function addFlows(a: Map<string, number>, b: Map<string, number>): Map<string, number> {
  const out = new Map(a);
  for (const [ym, v] of b) out.set(ym, (out.get(ym) ?? 0) + v);
  return out;
}

export type BenchmarkStatus = "good" | "warn" | "bad" | "na";

export interface ShareResult {
  status: BenchmarkStatus;
  /** Доля в доходе, 0…; `null` — дохода в окне нет. */
  share: number | null;
  /** Порог долей (0,33). */
  limit: number;
  /** В среднем в месяц. */
  amount: number;
  income: number;
  months: number;
  /** В скольких месяцах доля была выше порога. */
  monthsOver: number;
}

/** Чуть выше порога — «Выше нормы», заметно выше — «Высоко». */
const WARN_BAND = 1.15;

/** Доля расхода в доходе против порога — жильё, платежи по кредитам. */
export function shareBenchmark(
  window: BenchmarkWindow,
  flow: Map<string, number>,
  limitPct: number
): ShareResult {
  const limit = limitPct / 100;
  const months = window.yms.length;
  let amount = 0;
  let income = 0;
  let monthsOver = 0;
  for (const ym of window.yms) {
    const a = flow.get(ym) ?? 0;
    const i = window.income.get(ym) ?? 0;
    amount += a;
    income += i;
    if (i > 0 ? a / i > limit : a > 0) monthsOver++;
  }
  const share = income > 0 ? amount / income : null;
  return {
    status: shareStatus(share, limit),
    share,
    limit,
    amount: months > 0 ? amount / months : 0,
    income: months > 0 ? income / months : 0,
    months,
    monthsOver,
  };
}

/** Статус доли против порога — один на все «доли в доходе». */
function shareStatus(share: number | null, limit: number): BenchmarkStatus {
  return share === null ? "na" : share <= limit ? "good" : share <= limit * WARN_BAND ? "warn" : "bad";
}

/**
 * Доля готовой месячной суммы в среднем доходе окна — для «Регулярных
 * платежей»: они известны сразу суммой в месяц, а не рядом по месяцам.
 */
export function flatShareBenchmark(
  window: BenchmarkWindow,
  monthlyAmount: number,
  limitPct: number
): ShareResult {
  const limit = limitPct / 100;
  const months = window.yms.length;
  const income = months > 0 ? window.yms.reduce((s, ym) => s + (window.income.get(ym) ?? 0), 0) / months : 0;
  const share = income > 0 ? monthlyAmount / income : null;
  return { status: shareStatus(share, limit), share, limit, amount: monthlyAmount, income, months, monthsOver: 0 };
}

/**
 * Похож ли регулярный платёж на подписку: платится раз в месяц или реже и
 * почти одной суммой. Раздел «Регулярные» берёт шире — туда попадает и
 * привычный магазин у дома, а это не подписка.
 */
export function isSubscription(c: { cadence: string; consistency: number; stale: boolean }): boolean {
  return !c.stale && c.cadence !== "weekly" && c.consistency >= 0.7;
}

export interface GrowthResult {
  status: BenchmarkStatus;
  /** Месяцев в каждой половине сравнения; меньше трёх — сравнивать не с чем. */
  months: number;
  /** Рост к предыдущему отрезку, доли; `null` — прежде было ноль. */
  incomeGrowth: number | null;
  expenseGrowth: number | null;
  /** На сколько рост расходов обгоняет рост доходов, доли. */
  gap: number | null;
  /** В среднем в месяц: сейчас и прежде. */
  income: { now: number; prev: number };
  expense: { now: number; prev: number };
}

/**
 * Растут ли расходы быстрее доходов: последние 12 завершённых месяцев против
 * предыдущих 12. Истории меньше двух лет — делим её пополам; меньше полугода —
 * сравнивать не с чем.
 */
export function growthBenchmark(
  analyticsTx: Transaction[],
  monthStartDay: number,
  today: string
): GrowthResult {
  const current = periodKey(today, monthStartDay);
  const done = groupByMonth(analyticsTx, { monthStartDay }).filter((m) => m.ym < current);
  const n = Math.min(BENCHMARK_MONTHS, Math.floor(done.length / 2));
  const avg = (list: typeof done, pick: (m: (typeof done)[number]) => number) =>
    list.length > 0 ? list.reduce((s, m) => s + pick(m), 0) / list.length : 0;
  const now = n > 0 ? done.slice(-n) : [];
  const prev = n > 0 ? done.slice(-2 * n, -n) : [];
  const income = { now: avg(now, (m) => m.income), prev: avg(prev, (m) => m.income) };
  const expense = { now: avg(now, (m) => m.expense), prev: avg(prev, (m) => m.expense) };
  const growth = (x: { now: number; prev: number }) => (x.prev > 0 ? x.now / x.prev - 1 : null);
  const incomeGrowth = growth(income);
  const expenseGrowth = growth(expense);
  const gap = incomeGrowth !== null && expenseGrowth !== null ? expenseGrowth - incomeGrowth : null;
  const status: BenchmarkStatus =
    n < 3 || gap === null ? "na" : gap <= 0 ? "good" : gap <= 0.05 ? "warn" : "bad";
  return { status, months: n, incomeGrowth, expenseGrowth, gap, income, expense };
}

export interface TargetShareResult {
  status: BenchmarkStatus;
  /** Доля в доходе; `null` — дохода в окне нет. Отрицательная — забрали больше, чем внесли. */
  share: number | null;
  /** Цель долей (0,1). */
  target: number;
  /** В среднем в месяц. */
  amount: number;
  income: number;
  /** Сколько в месяц не хватает до цели; 0 — цель выполнена. */
  gap: number;
  months: number;
}

/** Доля в доходе против цели «не меньше» — вложения: чем больше, тем лучше. */
export function targetShareBenchmark(
  window: BenchmarkWindow,
  flow: Map<string, number>,
  targetPct: number
): TargetShareResult {
  const target = targetPct / 100;
  const months = window.yms.length;
  let amount = 0;
  let income = 0;
  for (const ym of window.yms) {
    amount += flow.get(ym) ?? 0;
    income += window.income.get(ym) ?? 0;
  }
  const share = income > 0 ? amount / income : null;
  const status: BenchmarkStatus =
    share === null ? "na" : share >= target ? "good" : share >= target / 2 ? "warn" : "bad";
  const perMonth = (v: number) => (months > 0 ? v / months : 0);
  return {
    status,
    share,
    target,
    amount: perMonth(amount),
    income: perMonth(income),
    gap: Math.max(0, perMonth(income * target - amount)),
    months,
  };
}

/** Правило 72: за сколько лет сумма удвоится при доходности `ratePct` % годовых. */
export function doublingYears(ratePct: number): number | null {
  return ratePct > 0 ? 72 / ratePct : null;
}
