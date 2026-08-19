/**
 * Единая модель данных главной страницы.
 *
 * Все варианты главной читают её и только её. Смысл в том, чтобы «сколько
 * свободно» и «трачу ли больше обычного» считались один раз и одинаково: иначе
 * два варианта одной страницы покажут разные числа, и сравнивать их будет
 * бессмысленно.
 *
 * Три вещи здесь сделаны иначе, чем на старой главной:
 *   • операции берутся через `useAnalyticsTransactions` — значит страница
 *     наконец слушает разрез данных, как остальные десять экранов;
 *   • итог по предстоящим платежам считается в базовой валюте (см.
 *     `upcomingPayments`), а не складывает доллары с рублями;
 *   • текущий месяц сравнивается с прожитой долей прошлых, а не с целым
 *     месяцем — отсюда честный «темп» вместо «↓ 58 %» восемнадцатого числа.
 */

import { useEffect, useMemo, useState } from "react";
import { useAnalyticsTransactions } from "./useAnalyticsTransactions";
import { useDataStore } from "../store/useDataStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { useOffBalanceStore } from "../store/useOffBalanceStore";
import { useNetWorthSeries } from "./useNetWorthSeries";
import {
  getLiveAccountsFromCache,
  type LiveAccount,
} from "../store/useZenmoneyStore";
import {
  groupByMonth,
  groupByCategory,
  dailyExpenseMap,
  detectRecurring,
  buildForecast,
  balancesByAccount,
  buildInsights,
  detectMonthSpikes,
  type DayCell,
  type MonthBucket,
  type MonthSpike,
  type CategoryBucket,
  type Insight,
} from "../lib/aggregations";
import { buildNeedsWants, type NeedsWantsSplit } from "../lib/needsWants";
import { currentPeriod, periodKey } from "../lib/period";
import {
  monthProgress,
  paceRatio,
  projectExpense,
  upcomingPayments,
  upcomingTotal,
  freeMoney,
  monthEnd,
  type MonthProgress,
  type UpcomingPayment,
  type FreeMoney,
} from "../lib/dashboardModel";
import type { Currency } from "../types";

export interface DashboardAccount {
  title: string;
  balanceBase: number;
  nativeBalance: number;
  nativeCurrency: Currency;
  type: string;
  savings: boolean;
  archive: boolean;
  offBalance: boolean;
}

export interface DashboardModel {
  ready: boolean;
  base: Currency;
  /** Текущий период в виде YYYY-MM. */
  ym: string;
  month: MonthProgress;

  /** Совокупный баланс и его история. */
  netWorth: number;
  netWorthSeries: { date: string; net: number }[];
  accounts: DashboardAccount[];
  /** Разложение баланса: обычные счета, накопительные, вне баланса. */
  liquid: number;
  savings: number;

  /** Факт текущего периода и прогноз до конца. */
  factIncome: number;
  factExpense: number;
  projIncome: number;
  projExpense: number;
  /** Во сколько раз темп трат отличается от обычного. `null` — не с чем сравнить. */
  pace: number | null;
  /** Средний расход за прошлые полные месяцы. */
  avgExpense: number;

  upcoming: UpcomingPayment[];
  upcomingTotalBase: number;
  free: FreeMoney;

  /** Помесячная история и прогноз для графика. */
  months: MonthBucket[];
  forecast: ReturnType<typeof buildForecast>;
  /** Категории текущего периода, по убыванию расхода. */
  categories: CategoryBucket[];
  /** Категории, которые в этом месяце заметно разогнались. */
  spikes: MonthSpike[];
  needsWants: NeedsWantsSplit | null;
  dayMap: Map<string, DayCell>;
  insights: Insight[];
  /** Ближайшие регулярные, включая уже прошедшие в этом месяце — для счётчика. */
  recurringMonthlyCount: number;
}

/** Сколько месяцев истории берём для «обычного» расхода. */
const AVG_WINDOW = 6;

export function useDashboardModel(): DashboardModel {
  const transactions = useAnalyticsTransactions();
  const rates = useDataStore((s) => s.rates);
  const base = rates.base;
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);

  const categoryMeta = useCategoryMetaStore((s) => s.meta);
  const metaHydrate = useCategoryMetaStore((s) => s.hydrate);
  const metaLoaded = useCategoryMetaStore((s) => s.loaded);
  useEffect(() => {
    if (!metaLoaded) metaHydrate();
  }, [metaLoaded, metaHydrate]);

  const includeOffBalance = useOffBalanceStore((s) => s.includeOffBalance);

  // Счета из кэша Дзен-мани: там есть начальные остатки и признаки
  // «накопительный» / «вне баланса», которых по одним операциям не восстановить.
  const [liveAccounts, setLiveAccounts] = useState<LiveAccount[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    getLiveAccountsFromCache().then((data) => {
      if (!cancelled) setLiveAccounts(data);
    });
    return () => {
      cancelled = true;
    };
  }, [transactions]);

  const ym = useMemo(() => currentPeriod(monthStartDay), [monthStartDay]);
  const month = useMemo(() => monthProgress(ym), [ym]);

  const months = useMemo(
    () => groupByMonth(transactions, { monthStartDay }),
    [transactions, monthStartDay]
  );
  const forecast = useMemo(
    () => buildForecast(transactions, 3, 6, { monthStartDay }),
    [transactions, monthStartDay]
  );
  const netWorthSeries = useNetWorthSeries(transactions);
  const dayMap = useMemo(() => dailyExpenseMap(transactions), [transactions]);
  const recurring = useMemo(() => detectRecurring(transactions), [transactions]);
  const spikes = useMemo(() => detectMonthSpikes(transactions), [transactions]);

  const insights = useMemo(() => {
    const year = new Date().getFullYear().toString();
    return buildInsights(transactions.filter((t) => t.date.startsWith(year)));
  }, [transactions]);

  const thisMonthTxs = useMemo(
    () => transactions.filter((t) => periodKey(t.date, monthStartDay) === ym),
    [transactions, monthStartDay, ym]
  );

  const categories = useMemo(
    () => groupByCategory(thisMonthTxs, "top").filter((c) => c.expense > 0),
    [thisMonthTxs]
  );

  // Обязательное / необязательное считаем по последнему ЗАВЕРШЁННОМУ месяцу:
  // в текущем половина обязательных платежей ещё не прошла, и доля вышла бы
  // заниженной просто потому, что сегодня восемнадцатое.
  const needsWants = useMemo(() => {
    const complete = months.filter((m) => m.ym < ym);
    const lastYM = complete[complete.length - 1]?.ym;
    if (!lastYM) return null;
    const txs = transactions.filter((t) => periodKey(t.date, monthStartDay) === lastYM);
    return buildNeedsWants(txs, categoryMeta);
  }, [months, ym, transactions, monthStartDay, categoryMeta]);

  const accounts = useMemo<DashboardAccount[]>(() => {
    if (liveAccounts && liveAccounts.length > 0) {
      return liveAccounts
        .filter((a) => (includeOffBalance ? true : a.inBalance))
        .filter((a) => !a.archive)
        .filter((a) => Math.abs(a.balance) > 0.005)
        .map((a) => ({
          title: a.title,
          balanceBase:
            a.currency === base ? a.balance : a.balance * (rates.rates[a.currency] || 1),
          nativeBalance: a.balance,
          nativeCurrency: a.currency,
          type: a.type,
          savings: a.savings,
          archive: a.archive,
          offBalance: !a.inBalance,
        }))
        .sort((a, b) => Math.abs(b.balanceBase) - Math.abs(a.balanceBase));
    }
    return balancesByAccount(transactions)
      .filter((a) => Math.abs(a.balance) > 0.005)
      .map((a) => ({
        title: a.account,
        balanceBase: a.balance,
        nativeBalance: a.balance,
        nativeCurrency: base,
        type: "",
        savings: false,
        archive: false,
        offBalance: false,
      }))
      .sort((a, b) => Math.abs(b.balanceBase) - Math.abs(a.balanceBase));
  }, [liveAccounts, transactions, base, rates, includeOffBalance]);

  const netWorth = netWorthSeries.length
    ? netWorthSeries[netWorthSeries.length - 1].net
    : accounts.reduce((s, a) => s + a.balanceBase, 0);

  const { liquid, savings } = useMemo(() => {
    let liq = 0;
    let sav = 0;
    for (const a of accounts) {
      if (a.savings) sav += a.balanceBase;
      else liq += a.balanceBase;
    }
    return { liquid: liq, savings: sav };
  }, [accounts]);

  const current = months.find((m) => m.ym === ym);
  const factIncome = current?.income ?? 0;
  const factExpense = current?.expense ?? 0;

  // «Обычный» месяц — среднее по последним завершённым, без текущего:
  // он неполный и занизил бы планку, с которой сравниваем темп.
  const avgExpense = useMemo(() => {
    const complete = months.filter((m) => m.ym < ym).slice(-AVG_WINDOW);
    if (complete.length === 0) return 0;
    return complete.reduce((s, m) => s + m.expense, 0) / complete.length;
  }, [months, ym]);

  const avgIncome = useMemo(() => {
    const complete = months.filter((m) => m.ym < ym).slice(-AVG_WINDOW);
    if (complete.length === 0) return 0;
    return complete.reduce((s, m) => s + m.income, 0) / complete.length;
  }, [months, ym]);

  const pace = paceRatio(factExpense, month.progress, avgExpense);
  const projExpense = month.running
    ? Math.max(factExpense, projectExpense(factExpense, month.progress))
    : factExpense;
  // Доход не экстраполируем по темпу: зарплата приходит одним днём, и до неё
  // линейный прогноз дал бы почти ноль. Берём большее из факта и среднего.
  const projIncome = month.running ? Math.max(factIncome, avgIncome) : factIncome;

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = useMemo(
    () => upcomingPayments(recurring, rates, today, monthEnd(ym)),
    [recurring, rates, today, ym]
  );
  const upcomingTotalBase = useMemo(() => upcomingTotal(upcoming), [upcoming]);

  const free = freeMoney({
    projIncome,
    factExpense,
    aheadObligatory: upcomingTotalBase,
  });

  const recurringMonthlyCount = useMemo(
    () => recurring.filter((r) => !r.stale && r.cadence === "monthly").length,
    [recurring]
  );

  return {
    ready: transactions.length > 0,
    base,
    ym,
    month,
    netWorth,
    netWorthSeries,
    accounts,
    liquid,
    savings,
    factIncome,
    factExpense,
    projIncome,
    projExpense,
    pace,
    avgExpense,
    upcoming,
    upcomingTotalBase,
    free,
    months,
    forecast,
    categories,
    spikes,
    needsWants,
    dayMap,
    insights,
    recurringMonthlyCount,
  };
}
