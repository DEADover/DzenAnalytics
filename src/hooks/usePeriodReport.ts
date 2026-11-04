import { useEffect, useMemo } from "react";
import { netWorthSeries, stackedBalanceByAccount } from "../lib/aggregations";
import { colorForCategory } from "../lib/categoryColor";
import { periodKey, shiftDays, shiftPeriod, type DayRange } from "../lib/period";
import {
  buildPeriodReport,
  previousRange,
  rangeText,
  reportTitle,
  type PeriodReportModel,
} from "../lib/periodReport";
import { buildReportBudget, type ReportBudget } from "../lib/periodReportBudget";
import { useBudgetsStore } from "../store/useBudgetsStore";
import { useCalibrationStore } from "../store/useCalibrationStore";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { useDataStore } from "../store/useDataStore";
import { useDraftsStore } from "../store/useDraftsStore";
import { applyFilters, presetToRange, useFiltersStore } from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useAccountDirectory } from "./useAccountDirectory";
import { useAnalyticsTransactions } from "./useAnalyticsTransactions";
import { useBalanceValuation } from "./useBalanceValuation";
import { useBudgetScope } from "./useBudgetScope";

export interface ReportAccountRow {
  key: string;
  label: string;
  start: number;
  end: number;
}

export interface PeriodReport extends PeriodReportModel {
  title: string;
  /** Период — месяц (календарный или отчётный). */
  isMonth: boolean;
  /** Даты периода строкой — подзаголовок обложки. */
  dates: string;
  base: string;
  /** Что сузили общие фильтры — «Счета: Тинькофф, Наличные». Пусто — всё. */
  filters: string[];
  /** Капитал на начало и конец. `null` — история не начиналась. */
  capital: { start: number; end: number } | null;
  /** Остатки по счетам (только с подключённым Дзен-мани). */
  accounts: ReportAccountRow[];
  budget: ReportBudget | null;
}

/** Значение ряда на конец дня `date` — последняя точка не позже него. */
function valueAt<T extends { date: string }>(series: readonly T[], date: string, pick: (p: T) => number): number | null {
  let out: number | null = null;
  for (const p of series) {
    if (p.date > date) break;
    out = pick(p);
  }
  return out;
}

/**
 * «Отчёт за период»: период и фильтры — общие, сверху страницы; всё остальное
 * — из тех же расчётов, что в разделах (см. `lib/periodReport`).
 *
 * Операции — `useAnalyticsTransactions`, как у главной, «Дайджеста» и «Доходов
 * и расходов»: без счетов вне баланса (пока они не считаются) и без того, что
 * исключает активный разрез. Бюджет — по своему периметру и правилам раздела
 * «Бюджеты» (`useBudgetScope`), как и там.
 */
export function usePeriodReport(): PeriodReport | null {
  const txs = useAnalyticsTransactions();
  const rawTxs = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const filters = useFiltersStore();
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);
  const meta = useCategoryMetaStore((s) => s.meta);
  const metaLoaded = useCategoryMetaStore((s) => s.loaded);
  const hydrateMeta = useCategoryMetaStore((s) => s.hydrate);
  const lines = useBudgetsStore((s) => s.lines);
  const budgetsLoaded = useBudgetsStore((s) => s.loaded);
  const hydrateBudgets = useBudgetsStore((s) => s.hydrate);
  const { scope } = useBudgetScope();
  const dir = useAccountDirectory();
  const valuation = useBalanceValuation();
  const drafts = useDraftsStore((s) => s.drafts);
  const calibration = useCalibrationStore((s) => s.calibration);

  useEffect(() => {
    if (!metaLoaded) hydrateMeta();
  }, [metaLoaded, hydrateMeta]);
  useEffect(() => {
    if (!budgetsLoaded) hydrateBudgets();
  }, [budgetsLoaded, hydrateBudgets]);

  // Все фильтры, кроме периода: из них берутся и период, и прошлый для сравнения.
  const scoped = useMemo(
    () => applyFilters(txs, { ...filters, preset: "all" }, monthStartDay),
    [txs, filters, monthStartDay]
  );
  const maxDate = useMemo(() => txs.reduce((m, t) => (t.date > m ? t.date : m), "").slice(0, 10), [txs]);

  const range = useMemo<DayRange | null>(() => {
    if (filters.preset === "all") {
      const min = scoped.reduce((m, t) => (!m || t.date < m ? t.date : m), "").slice(0, 10);
      return min && maxDate ? { from: min, to: maxDate } : null;
    }
    const r =
      filters.preset === "custom"
        ? { from: filters.from, to: filters.to }
        : presetToRange(filters.preset, maxDate, filters.monthYM, monthStartDay, filters.windowShift);
    return r.from && r.to ? { from: r.from.slice(0, 10), to: r.to.slice(0, 10) } : null;
  }, [filters, scoped, maxDate, monthStartDay]);

  const model = useMemo(() => {
    if (!range) return null;
    return buildPeriodReport({
      txs: scoped,
      range,
      prevRange: previousRange(filters.preset, range, filters.monthYM, monthStartDay),
      maxDate,
      monthStartDay,
      isMonth: filters.preset === "month" || filters.preset === "period",
      colorOf: (name) => colorForCategory(name, meta),
    });
  }, [scoped, range, filters.preset, filters.monthYM, monthStartDay, maxDate, meta]);

  // Остатки: с Дзен-мани — по счетам, как «Остатки по счетам» и «Капитал»;
  // без него (CSV) — только капитал от нуля с калибровкой.
  const balances = useMemo(() => {
    if (!model) return { capital: null, accounts: [] as ReportAccountRow[] };
    const before = shiftDays(model.range.from, -1);
    const end = model.lastDay;
    if (valuation) {
      const universe = [...(valuation.universe ?? [])];
      const picked = filters.accounts.size > 0 ? universe.filter((k) => filters.accounts.has(k)) : universe;
      if (picked.length === 0) return { capital: null, accounts: [] };
      const { series } = stackedBalanceByAccount(txs, 0, null, new Set(Object.keys(drafts)), picked, null, valuation);
      const num = (v: unknown) => (typeof v === "number" ? v : 0);
      const accounts = picked
        .map((key) => ({
          key,
          label: dir.label(key),
          start: valueAt(series, before, (p) => num(p[key])) ?? 0,
          end: valueAt(series, end, (p) => num(p[key])) ?? 0,
        }))
        .filter((a) => Math.abs(a.start) >= 0.5 || Math.abs(a.end) >= 0.5)
        .sort((a, b) => Math.abs(b.end) - Math.abs(a.end));
      const s = valueAt(series, before, (p) => p.total);
      const e = valueAt(series, end, (p) => p.total);
      return { capital: e === null ? null : { start: s ?? 0, end: e }, accounts };
    }
    const series = netWorthSeries(txs, calibration);
    const e = valueAt(series, end, (p) => p.net);
    return { capital: e === null ? null : { start: valueAt(series, before, (p) => p.net) ?? 0, end: e }, accounts: [] };
  }, [model, valuation, filters.accounts, txs, drafts, dir, calibration]);

  const budget = useMemo(() => {
    if (!model) return null;
    const months: string[] = [];
    const last = periodKey(model.lastDay, monthStartDay);
    for (let ym = periodKey(model.range.from, monthStartDay); ym <= last && months.length < 600; ym = shiftPeriod(ym, 1))
      months.push(ym);
    return buildReportBudget(lines, rawTxs, months, scope, monthStartDay);
  }, [model, lines, rawTxs, scope, monthStartDay]);

  const filterNotes = useMemo(() => {
    const out: string[] = [];
    const names = (keys: Iterable<string>, of: (k: string) => string) => {
      const list = [...keys].map(of);
      return list.length <= 3 ? list.join(", ") : `${list.slice(0, 3).join(", ")} и ещё ${list.length - 3}`;
    };
    if (filters.accounts.size > 0) out.push(`Счета: ${names(filters.accounts, dir.label)}`);
    if (filters.categories.size > 0) out.push(`Категории: ${names(filters.categories, (c) => c)}`);
    if (filters.search.trim()) out.push(`Поиск: «${filters.search.trim()}»`);
    return out;
  }, [filters.accounts, filters.categories, filters.search, dir]);

  if (!model) return null;
  return {
    ...model,
    title: reportTitle(filters.preset, model.range, filters.monthYM),
    isMonth: filters.preset === "month" || filters.preset === "period",
    dates: rangeText(model.range),
    base,
    filters: filterNotes,
    capital: balances.capital,
    accounts: balances.accounts,
    budget,
  };
}
