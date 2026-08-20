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

import { useEffect, useMemo } from "react";
import { useAnalyticsTransactions } from "./useAnalyticsTransactions";
import { useDataStore } from "../store/useDataStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { useOffBalanceStore } from "../store/useOffBalanceStore";
import { useNetWorthSeries } from "./useNetWorthSeries";
import { useLiveAccounts } from "./useLiveAccounts";
import {
  groupByMonth,
  groupByCategory,
  dailyExpenseMap,
  detectRecurring,
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
import { useBudgetsStore } from "../store/useBudgetsStore";
import { buildNotices, type Notice } from "../lib/dashboardNotices";
import { plannedFor } from "../lib/budgets";
import { currentPeriod, periodKey } from "../lib/period";
import {
  monthProgress,
  paceRatio,
  projectExpense,
  upcomingPayments,
  upcomingTotal,
  freeMoney,
  monthEnd,
  forecastMonths,
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
  /** Сколько операций текущего периода дошло до расчёта. */
  currentCount: number;
  /**
   * В текущем периоде есть хоть одна учтённая операция.
   *
   * `false` при живой истории означает, что период вычистил отбор — разрез
   * данных или скрытые внебалансовые счета. Варианты обязаны сказать об этом
   * прямо, а не показывать нули как факт.
   */
  hasCurrentData: boolean;
  /**
   * План месяца из раздела «Бюджет», если он у пользователя заведён.
   *
   * Показывается ОТДЕЛЬНО от факта и никогда с ним не смешивается: раньше
   * прогноз дохода подменялся средним за прошлые месяцы, и на главной стояло
   * «543,8 тыс», когда месяц принёс 159 тыс, — числа расходились с «Бюджетом»
   * без всякого объяснения. `null` — планов нет.
   */
  planIncome: number | null;
  planExpense: number | null;

  upcoming: UpcomingPayment[];
  upcomingTotalBase: number;
  free: FreeMoney;

  /** Помесячная история и прогноз для графика. */
  months: MonthBucket[];
  /** История месяцев и прогноз следом за ней. */
  forecast: { ym: string; income: number; expense: number; isForecast: boolean }[];
  /** Категории текущего периода, по убыванию расхода. */
  categories: CategoryBucket[];
  /** Категории, которые в этом месяце заметно разогнались. */
  spikes: MonthSpike[];
  needsWants: NeedsWantsSplit | null;
  dayMap: Map<string, DayCell>;
  insights: Insight[];
  /** Ближайшие регулярные, включая уже прошедшие в этом месяце — для счётчика. */
  recurringMonthlyCount: number;
  /**
   * Отобранные и упорядоченные наблюдения для блока «Что заметно».
   *
   * Собираются в чистой функции `buildNotices`, а не в вёрстке: иначе каждая
   * раскладка решала бы сама, что показать, и четыре варианта разъехались бы
   * по содержанию, а не по виду.
   */
  notices: Notice[];
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

  const budgetLines = useBudgetsStore((s) => s.lines);
  const budgetsHydrate = useBudgetsStore((s) => s.hydrate);
  const budgetsLoaded = useBudgetsStore((s) => s.loaded);
  useEffect(() => {
    if (!budgetsLoaded) void budgetsHydrate();
  }, [budgetsLoaded, budgetsHydrate]);

  // Счета из кэша Дзен-мани: там есть начальные остатки и признаки
  // «накопительный» / «вне баланса», которых по одним операциям не восстановить.
  const liveAccounts = useLiveAccounts();

  const ym = useMemo(() => currentPeriod(monthStartDay), [monthStartDay]);
  const month = useMemo(() => monthProgress(ym), [ym]);

  const months = useMemo(
    () => groupByMonth(transactions, { monthStartDay }),
    [transactions, monthStartDay]
  );
  // Прогноз строится по ЗАВЕРШЁННЫМ месяцам: текущий неполный, и в среднем он
  // занижал бы все месяцы вперёд. Сезонность добавляет различие между ними —
  // раньше на все три ставилось одно и то же число.
  const forecast = useMemo(() => {
    const history = months.map((b) => ({
      ym: b.ym,
      income: b.income,
      expense: b.expense,
      isForecast: false,
    }));
    const complete = months.filter((b) => b.ym < ym);
    // Прогноз начинается со следующего месяца после текущего: сам текущий уже
    // нарисован фактом, пусть и неполным.
    return [...history, ...forecastMonths(complete, 3, 6, ym)];
  }, [months, ym]);
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
  // Сколько операций текущего периода реально дошло до расчёта. Ноль при живой
  // истории — это не «месяц без трат», а отбор: разрез данных или скрытые
  // внебалансовые счета. Показывать в таком случае бодрое «свободно 534 135 ₽»
  // нельзя, поэтому варианты обязаны проверить этот признак.
  const currentCount = current?.count ?? 0;
  const hasCurrentData = currentCount > 0;

  // «Обычный» месяц — среднее по последним завершённым, без текущего:
  // он неполный и занизил бы планку, с которой сравниваем темп.
  const avgExpense = useMemo(() => {
    const complete = months.filter((m) => m.ym < ym).slice(-AVG_WINDOW);
    if (complete.length === 0) return 0;
    return complete.reduce((s, m) => s + m.expense, 0) / complete.length;
  }, [months, ym]);


  // Темп считаем только когда в периоде вообще что-то потрачено. При нулевом
  // факте формула даёт ровно −100 %, и «темп на 100 % ниже обычного» звучит
  // как достижение, хотя означает всего лишь отсутствие данных.
  const pace = factExpense > 0 ? paceRatio(factExpense, month.progress, avgExpense) : null;
  const projExpense = month.running
    ? Math.max(factExpense, projectExpense(factExpense, month.progress))
    : factExpense;
  // Доход НЕ прогнозируем вовсе. По темпу нельзя — зарплата приходит одним
  // днём; средним за прошлые месяцы нельзя тем более — это уже не прогноз, а
  // подмена факта, из-за которой главная и «Бюджет» показывали разные числа.
  // Ожидаемый доход, если он вообще известен, — это план месяца, и он живёт
  // отдельным полем.
  const projIncome = factIncome;

  const today = new Date().toISOString().slice(0, 10);
  // Комментарий берём у последней операции группы: `txIds` идут по возрастанию
  // даты, и именно свежий комментарий объясняет, что это за платёж.
  const commentFor = useMemo(() => {
    const byId = new Map(transactions.map((t) => [t.id, t]));
    return (c: { txIds: string[] }) =>
      byId.get(c.txIds[c.txIds.length - 1])?.comment?.trim() || undefined;
  }, [transactions]);

  const upcoming = useMemo(
    () => upcomingPayments(recurring, rates, today, monthEnd(ym), commentFor),
    [recurring, rates, today, ym, commentFor]
  );
  const upcomingTotalBase = useMemo(() => upcomingTotal(upcoming), [upcoming]);

  const free = freeMoney({ factIncome, factExpense });

  // План месяца берём из тех же строк бюджета, что и раздел «Бюджет».
  const { planIncome, planExpense } = useMemo(() => {
    if (!budgetLines.length) return { planIncome: null, planExpense: null };
    let inc = 0;
    let exp = 0;
    for (const line of budgetLines) {
      const p = plannedFor(line, ym);
      if (line.kind === "income") inc += p;
      else exp += p;
    }
    return { planIncome: inc, planExpense: exp };
  }, [budgetLines, ym]);

  // Факт по статьям за месяц — в том же виде, в каком его ждёт отбор наблюдений.
  const factByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of categories) map.set(c.category, c.expense);
    return map;
  }, [categories]);

  const planByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of budgetLines) {
      if (line.kind === "income") continue;
      const p = plannedFor(line, ym);
      if (p <= 0) continue;
      map.set(line.category, (map.get(line.category) ?? 0) + p);
    }
    return map;
  }, [budgetLines, ym]);

  const notices = useMemo(
    () =>
      buildNotices({
        ym,
        base,
        today,
        spikes,
        recurring,
        planByCategory,
        factByCategory,
        insights,
      }),
    [ym, base, today, spikes, recurring, planByCategory, factByCategory, insights]
  );

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
    currentCount,
    hasCurrentData,
    planIncome,
    planExpense,
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
    notices,
  };
}
