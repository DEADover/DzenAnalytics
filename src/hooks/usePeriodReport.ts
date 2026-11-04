import { useEffect, useMemo } from "react";
import { netWorthSeries, stackedBalanceByAccount } from "../lib/aggregations";
import { colorForCategory } from "../lib/categoryColor";
import type { DigestEntry } from "../lib/digest";
import type { DigestObservation } from "../lib/digestObservations";
import { endAfterDays, periodKey, shiftDays, shiftPeriod, type DayRange } from "../lib/period";
import { applyDigest, buildPeriodReport, previousRange, rangeText, type PeriodReportModel } from "../lib/periodReport";
import { buildReportBudget, type ReportBudget } from "../lib/periodReportBudget";
import { useBudgetsStore } from "../store/useBudgetsStore";
import { useCalibrationStore } from "../store/useCalibrationStore";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { useDataStore } from "../store/useDataStore";
import { useDraftsStore } from "../store/useDraftsStore";
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

/** Какой период отчёта — из «Дайджеста»: месяц или неделя. */
export interface ReportSpec {
  kind: "month" | "week";
  range: DayRange;
  /** Название на обложке: «Октябрь 2026», «Неделя 12–18 октября 2026». */
  title: string;
  /**
   * Запись «Дайджеста» за этот период и его наблюдения: всё, что есть на его
   * странице, отчёт берёт отсюда — числа и слова совпадают с экраном
   * (`applyDigest`).
   */
  digest: DigestEntry;
  observations: DigestObservation[];
}

export interface PeriodReport extends PeriodReportModel {
  title: string;
  /** Период — месяц: «Половины месяца», «к тем же дням прошлого месяца». */
  isMonth: boolean;
  /** Даты периода строкой — подзаголовок обложки. */
  dates: string;
  base: string;
  /** Капитал на начало и конец. `null` — история не начиналась. */
  capital: { start: number; end: number } | null;
  /** Остатки по счетам (только с подключённым Дзен-мани). */
  accounts: ReportAccountRow[];
  /** Бюджет — у месяца; у недели нет: план помесячный, и неделю с ним не сравнить. */
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
 * Отчёт за период «Дайджеста» — из тех же расчётов, что разделы сервиса (см.
 * `lib/periodReport`). Операции — `useAnalyticsTransactions`, как у самого
 * «Дайджеста»: без счетов вне баланса (пока они не считаются) и без того, что
 * исключает активный разрез; общие фильтры не действуют, как и в «Дайджесте».
 * Бюджет — по периметру и правилам раздела «Бюджеты» (`useBudgetScope`).
 *
 * `spec` — `null`, пока отчёт не нужен: тогда ничего не считается.
 */
export function usePeriodReport(spec: ReportSpec | null): PeriodReport | null {
  const txs = useAnalyticsTransactions();
  const rawTxs = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
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
    if (spec && !metaLoaded) hydrateMeta();
  }, [spec, metaLoaded, hydrateMeta]);
  useEffect(() => {
    if (spec && !budgetsLoaded) hydrateBudgets();
  }, [spec, budgetsLoaded, hydrateBudgets]);

  const maxDate = useMemo(() => txs.reduce((m, t) => (t.date > m ? t.date : m), "").slice(0, 10), [txs]);

  const model = useMemo(() => {
    if (!spec) return null;
    const { range } = spec;
    // Месяц — отчётный, со своим первым днём, как в «Дайджесте»; неделя —
    // прошлые семь дней.
    const monthYM = spec.kind === "month" ? periodKey(range.from, monthStartDay) : null;
    // Идущий месяц «Дайджест» считает по сегодняшний день, а не по последней
    // операции: отчёт режет период там же, иначе «к этому дню» разошлось бы.
    const lastDay = spec.digest.running ? endAfterDays(range.from, spec.digest.running.day) : maxDate;
    const model = buildPeriodReport({
      txs,
      range,
      prevRange: previousRange(spec.kind === "month" ? "period" : "custom", range, monthYM, monthStartDay),
      maxDate: lastDay,
      monthStartDay,
      isMonth: spec.kind === "month",
      colorOf: (name) => colorForCategory(name, meta),
      typical: null,
      history: txs,
    });
    return applyDigest(model, spec.digest, spec.observations);
  }, [spec, txs, maxDate, monthStartDay, meta]);

  // Остатки: с Дзен-мани — по счетам, как «Остатки по счетам» и «Капитал»;
  // без него (CSV) — только капитал от нуля с калибровкой.
  const balances = useMemo(() => {
    if (!model) return { capital: null, accounts: [] as ReportAccountRow[] };
    const before = shiftDays(model.range.from, -1);
    const end = model.lastDay;
    if (valuation) {
      const picked = [...(valuation.universe ?? [])];
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
  }, [model, valuation, txs, drafts, dir, calibration]);

  const budget = useMemo(() => {
    if (!model || spec?.kind !== "month") return null;
    const months: string[] = [];
    const last = periodKey(model.lastDay, monthStartDay);
    for (let ym = periodKey(model.range.from, monthStartDay); ym <= last && months.length < 600; ym = shiftPeriod(ym, 1))
      months.push(ym);
    return buildReportBudget(lines, rawTxs, months, scope, monthStartDay);
  }, [model, spec?.kind, lines, rawTxs, scope, monthStartDay]);

  if (!model || !spec) return null;
  return {
    ...model,
    title: spec.title,
    isMonth: spec.kind === "month",
    dates: rangeText(model.range),
    base,
    capital: balances.capital,
    accounts: balances.accounts,
    budget,
  };
}
