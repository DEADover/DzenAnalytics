import { useMemo } from "react";
import { useDataStore } from "../store/useDataStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useBenchmarksStore } from "../store/useBenchmarksStore";
import { useAnalyticsTransactions } from "./useAnalyticsTransactions";
import { useLiveAccounts } from "./useLiveAccounts";
import { accountKeyOf } from "../lib/accountKey";
import { toBase } from "../lib/csv";
import { localToday } from "../lib/period";
import {
  accountInflow,
  addFlows,
  benchmarkWindow,
  categoryFlow,
  doublingYears,
  flatShareBenchmark,
  growthBenchmark,
  isSubscription,
  ratioBenchmark,
  shareBenchmark,
  type GrowthResult,
  type RatioResult,
  type ShareResult,
} from "../lib/benchmarks";
import { detectRecurring, recurringMonthly } from "../lib/aggregations";

export interface BenchmarksModel {
  base: string;
  /** Месяцев в расчёте. */
  months: number;
  /** `null` — ориентир выключен. `configured` — есть из чего считать. */
  housing: { configured: boolean; result: ShareResult } | null;
  debt: { configured: boolean; result: ShareResult } | null;
  luxury: { configured: boolean; result: RatioResult } | null;
  doubling: {
    configured: boolean;
    /** Сколько сейчас на счетах инвестиций, в базовой валюте. */
    capital: number;
    accounts: number;
    rate: number;
    years: number | null;
  } | null;
  growth: GrowthResult | null;
  /** Подписки без жилья и кредитов — у тех свои ориентиры. */
  recurring: { result: ShareResult; count: number } | null;
}

/** Ключи счетов-кредитов — их берут «Платежи по кредитам», пока счета не выбраны. */
export function useLoanKeys(): string[] {
  const live = useLiveAccounts();
  return useMemo(() => (live ?? []).filter((a) => a.type === "loan").map(accountKeyOf), [live]);
}

/** «Ориентиры» в «Финансовом здоровье»: настройки + данные → готовые числа. */
export function useBenchmarks(): BenchmarksModel {
  const transactions = useDataStore((s) => s.transactions);
  const rates = useDataStore((s) => s.rates);
  const analyticsTx = useAnalyticsTransactions();
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);
  const live = useLiveAccounts();
  const loanKeys = useLoanKeys();
  const s = useBenchmarksStore();

  return useMemo(() => {
    const window = benchmarkWindow(analyticsTx, monthStartDay, localToday());
    const cats = (list: string[]) => categoryFlow(analyticsTx, new Set(list), window, monthStartDay);
    const moves = (list: string[], net: boolean) =>
      accountInflow(transactions, new Set(list), window, monthStartDay, net);

    const debtAccounts = s.debtAccounts ?? loanKeys;
    const invested = addFlows(moves(s.investAccounts, true), cats(s.investCategories));
    const investSet = new Set(s.investAccounts);
    const investLive = (live ?? []).filter((a) => investSet.has(accountKeyOf(a)));

    // Подписки — действующие регулярные платежи с ровной суммой. Жильё и
    // кредиты не берём: аренда тоже платится каждый месяц одной суммой, но у
    // неё свой ориентир, и здесь она задвоилась бы.
    let recurringSum = 0;
    let recurringCount = 0;
    if (s.recurringOn) {
      const own = new Set([...s.housingCategories, ...s.debtCategories]);
      const fullOf = new Map(analyticsTx.map((t) => [t.id, t.categoryFull]));
      for (const c of detectRecurring(analyticsTx)) {
        if (!isSubscription(c)) continue;
        const full = fullOf.get(c.txIds[c.txIds.length - 1]);
        if (full && own.has(full)) continue;
        recurringSum += toBase(recurringMonthly(c), c.currency, rates);
        recurringCount++;
      }
    }

    return {
      base: rates.base,
      months: window.yms.length,
      housing: s.housingOn
        ? {
            configured: s.housingCategories.length > 0,
            result: shareBenchmark(window, cats(s.housingCategories), s.housingLimit),
          }
        : null,
      debt: s.debtOn
        ? {
            configured: debtAccounts.length > 0 || s.debtCategories.length > 0,
            result: shareBenchmark(
              window,
              addFlows(moves(debtAccounts, false), cats(s.debtCategories)),
              s.debtLimit
            ),
          }
        : null,
      luxury: s.luxuryOn
        ? {
            configured:
              s.luxuryCategories.length > 0 &&
              (s.investAccounts.length > 0 || s.investCategories.length > 0),
            result: ratioBenchmark(window, invested, cats(s.luxuryCategories), s.luxuryRatio),
          }
        : null,
      doubling: s.doublingOn
        ? {
            configured: investLive.length > 0,
            capital: investLive.reduce((sum, a) => sum + toBase(a.balance, a.currency, rates), 0),
            accounts: investLive.length,
            rate: s.investRate,
            years: doublingYears(s.investRate),
          }
        : null,
      growth: s.growthOn ? growthBenchmark(analyticsTx, monthStartDay, localToday()) : null,
      recurring: s.recurringOn
        ? { result: flatShareBenchmark(window, recurringSum, s.recurringLimit), count: recurringCount }
        : null,
    };
  }, [analyticsTx, transactions, monthStartDay, rates, live, loanKeys, s]);
}
