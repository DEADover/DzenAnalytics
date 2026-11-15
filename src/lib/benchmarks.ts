/**
 * «Ориентиры» в «Финансовом здоровье» (#134): правила, с которыми сверяют
 * бюджет, — доля жилья и платежей по кредитам в доходе, вложения против трат
 * на роскошь, срок удвоения вложений. На общую оценку не влияют.
 *
 * Здесь только расчёт; настройки — `useBenchmarksStore`, сборка из данных
 * сервиса — `useBenchmarks`.
 */
import type { Transaction } from "../types";
import { groupByMonth } from "./aggregations";
import { txInKey, txOutKey } from "./accountKey";
import { periodKey } from "./period";
import { expenseDelta } from "./txKindStyle";

export interface BenchmarkSettings {
  housingOn: boolean;
  /** Категории жилья — листья, как в отборе по категориям (`categoryFull`). */
  housingCategories: string[];
  /** Порог, % дохода. */
  housingLimit: number;

  debtOn: boolean;
  /** Счета кредитов: платёж — перевод на такой счёт. `null` — все счета-кредиты. */
  debtAccounts: string[] | null;
  /** Категории, которыми платежи по кредитам записаны как расход. */
  debtCategories: string[];
  debtLimit: number;

  luxuryOn: boolean;
  luxuryCategories: string[];
  /** Во сколько раз вложений должно быть больше трат на роскошь. */
  luxuryRatio: number;

  doublingOn: boolean;
  /** Счета инвестиций: вложение — перевод на такой счёт. */
  investAccounts: string[];
  /** Категории, которыми вложения записаны как расход. */
  investCategories: string[];
  /** Ожидаемая доходность, % годовых. */
  investRate: number;
}

export const DEFAULT_BENCHMARKS: BenchmarkSettings = {
  housingOn: true,
  housingCategories: [],
  housingLimit: 33,
  debtOn: true,
  debtAccounts: null,
  debtCategories: [],
  debtLimit: 30,
  luxuryOn: true,
  luxuryCategories: [],
  luxuryRatio: 2,
  doublingOn: true,
  investAccounts: [],
  investCategories: [],
  investRate: 12,
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
    housingLimit: num(r.housingLimit, 5, 80) ?? d.housingLimit,
    debtOn: bool(r.debtOn) ?? d.debtOn,
    debtAccounts: r.debtAccounts === null ? null : (strings(r.debtAccounts) ?? d.debtAccounts),
    debtCategories: strings(r.debtCategories) ?? d.debtCategories,
    debtLimit: num(r.debtLimit, 5, 80) ?? d.debtLimit,
    luxuryOn: bool(r.luxuryOn) ?? d.luxuryOn,
    luxuryCategories: strings(r.luxuryCategories) ?? d.luxuryCategories,
    luxuryRatio: num(r.luxuryRatio, 0.5, 5) ?? d.luxuryRatio,
    doublingOn: bool(r.doublingOn) ?? d.doublingOn,
    investAccounts: strings(r.investAccounts) ?? d.investAccounts,
    investCategories: strings(r.investCategories) ?? d.investCategories,
    investRate: num(r.investRate, 1, 40) ?? d.investRate,
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
  const months = groupByMonth(analyticsTx, { monthStartDay });
  const current = periodKey(today, monthStartDay);
  const done = months.filter((m) => m.ym < current);
  const picked = (done.length > 0 ? done : months.filter((m) => m.ym <= current)).slice(-BENCHMARK_MONTHS);
  return { yms: picked.map((m) => m.ym), income: new Map(picked.map((m) => [m.ym, m.income])) };
}

/** Расход по категориям за месяцы окна; возвраты вычитаются. */
export function categoryFlow(
  analyticsTx: Transaction[],
  categories: ReadonlySet<string>,
  window: BenchmarkWindow,
  monthStartDay: number
): Map<string, number> {
  const out = new Map(window.yms.map((ym) => [ym, 0]));
  if (categories.size === 0) return out;
  for (const t of analyticsTx) {
    if (!categories.has(t.categoryFull)) continue;
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
  const status: BenchmarkStatus =
    share === null ? "na" : share <= limit ? "good" : share <= limit * WARN_BAND ? "warn" : "bad";
  return {
    status,
    share,
    limit,
    amount: months > 0 ? amount / months : 0,
    income: months > 0 ? income / months : 0,
    months,
    monthsOver,
  };
}

export interface RatioResult {
  status: BenchmarkStatus;
  /** Вложено ÷ потрачено на роскошь; `null` — на роскошь не тратили. */
  ratio: number | null;
  target: number;
  /** В среднем в месяц. */
  invested: number;
  luxury: number;
  /** Сколько в месяц не хватает до цели; 0 — цель выполнена. */
  gap: number;
  months: number;
}

/** Вложения против трат на роскошь: цель — вкладывать в `target` раз больше. */
export function ratioBenchmark(
  window: BenchmarkWindow,
  invested: Map<string, number>,
  luxury: Map<string, number>,
  target: number
): RatioResult {
  const months = window.yms.length;
  const sum = (m: Map<string, number>) => window.yms.reduce((s, ym) => s + (m.get(ym) ?? 0), 0);
  const inv = months > 0 ? sum(invested) / months : 0;
  const lux = months > 0 ? Math.max(0, sum(luxury)) / months : 0;
  const ratio = lux > 0 ? inv / lux : null;
  const gap = Math.max(0, lux * target - inv);
  const status: BenchmarkStatus =
    months === 0
      ? "na"
      : ratio === null
        ? inv > 0
          ? "good"
          : "na"
        : ratio >= target
          ? "good"
          : ratio >= target / 2
            ? "warn"
            : "bad";
  return { status, ratio, target, invested: inv, luxury: lux, gap, months };
}

/** Правило 72: за сколько лет сумма удвоится при доходности `ratePct` % годовых. */
export function doublingYears(ratePct: number): number | null {
  return ratePct > 0 ? 72 / ratePct : null;
}
