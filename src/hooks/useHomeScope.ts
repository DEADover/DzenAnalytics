/**
 * «Фильтры и выбор месяца» на главной (#130).
 *
 * Обычно главная про идущий месяц и про все счета. С этой настройкой над
 * виджетами появляются панель общих фильтров и листание месяца, и главная
 * считает за выбранный месяц и по фильтрам: так личный бюджет отделяется от
 * семейного, а год проходится месяц за месяцем с одной страницы.
 *
 * Хук отдаёт всё, что для этого нужно модели главной (`useDashboardModel`) и
 * самой странице. Когда настройка выключена, он ничего не меняет: модель
 * получает пустые параметры и считает как раньше.
 */

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useAnalyticsTransactions } from "./useAnalyticsTransactions";
import { useLiveAccounts } from "./useLiveAccounts";
import { useBalanceValuation } from "./useBalanceValuation";
import type { DashboardModelOptions } from "./useDashboardModel";
import { useDataStore } from "../store/useDataStore";
import { useDisplayStore } from "../store/useDisplayStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useFiltersStore, applyFilters, isNarrowed } from "../store/useFiltersStore";
import { capitalAccountKeys } from "../lib/monthReview";
import { accountKeyOf } from "../lib/accountKey";
import { currentPeriod, periodKey } from "../lib/period";
import type { Transaction } from "../types";

export interface HomeScope {
  /** Настройка включена: главная слушает фильтры и выбранный месяц. */
  on: boolean;
  /** Выбранный месяц, YYYY-MM; при выключенной настройке — идущий. */
  ym: string;
  setYm: (ym: string) => void;
  /** Идущий отчётный месяц и самый ранний месяц с операциями — границы листания. */
  nowYm: string;
  firstYm: string;
  /** Операции, по которым считает главная: после общих фильтров или как обычно. */
  transactions: Transaction[];
  /** Фильтры оставили не все операции — план бюджета рядом с фактом показывать нельзя. */
  narrowed: boolean;
  /** Под фильтры не попало ничего, хотя операции есть. */
  filteredOut: boolean;
  /** Счета из фильтра, по которым считать капитал; `null` — как обычно. */
  capitalKeys: string[] | null;
  /** Остатки по этим счетам известны (без Дзен-мани с фильтром счетов — нет). */
  capitalKnown: boolean;
  /** Параметры для `useDashboardModel`. */
  options: DashboardModelOptions;
}

const NO_OPTIONS: DashboardModelOptions = {};

export function useHomeScope(): HomeScope {
  const on = useDisplayStore((s) => s.homeFilters);
  const analytics = useAnalyticsTransactions();
  const allTransactions = useDataStore((s) => s.transactions);
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);

  // Общие фильтры действуют все, кроме периода: месяц здесь выбирают на самой
  // странице, и «текущий месяц» из фильтра оставил бы от графика один столбец.
  const filters = useFiltersStore();
  const pageFilters = useMemo(
    () => ({ ...filters, preset: "all" as const, from: null, to: null }),
    [filters]
  );
  const transactions = useMemo(
    () => (on ? applyFilters(analytics, pageFilters, monthStartDay) : analytics),
    [on, analytics, pageFilters, monthStartDay]
  );
  const narrowed = on && isNarrowed(filters);

  // Капитал и остатки — по счетам из фильтра; без фильтра — как обычно.
  const liveAccounts = useLiveAccounts();
  const valuation = useBalanceValuation();
  const capitalKeys = useMemo(
    () =>
      on && liveAccounts && valuation?.universe
        ? capitalAccountKeys({
            accounts: liveAccounts.map((a) => ({ key: accountKeyOf(a), member: a.member })),
            universe: valuation.universe,
            pickedAccounts: filters.accounts,
            pickedUsers: filters.users,
          })
        : null,
    [on, liveAccounts, valuation, filters.accounts, filters.users]
  );
  const capitalKnown =
    !on || !!liveAccounts || (filters.accounts.size === 0 && filters.users.size === 0);

  // Выбранный месяц живёт в ссылке: её можно сохранить и вернуться к ней
  // кнопкой «назад». Идущий месяц — без параметра, поэтому главная без
  // параметра всегда открывается на нём.
  const nowYm = useMemo(() => currentPeriod(monthStartDay), [monthStartDay]);
  const firstYm = useMemo(() => {
    let min = "";
    for (const t of analytics) if (!min || t.date < min) min = t.date;
    return min ? periodKey(min, monthStartDay) : nowYm;
  }, [analytics, monthStartDay, nowYm]);
  const [searchParams, setSearchParams] = useSearchParams();
  const param = searchParams.get("month");
  const ym =
    on && param && /^\d{4}-\d{2}$/.test(param) && param >= firstYm && param <= nowYm ? param : nowYm;
  const setYm = useCallback(
    (next: string) => {
      const clamped = next < firstYm ? firstYm : next > nowYm ? nowYm : next;
      setSearchParams(clamped === nowYm ? {} : { month: clamped }, { replace: true });
    },
    [firstYm, nowYm, setSearchParams]
  );

  const options = useMemo<DashboardModelOptions>(
    () =>
      on
        ? {
            ym,
            transactions,
            accountKeys: capitalKeys,
            // Остаток счёта не зависит от того, какие статьи отмечены: по
            // счетам из фильтра кривая считается по всем их операциям. Без
            // фильтра счетов — тем же рядом, что и обычно.
            capitalTransactions: capitalKeys ? allTransactions : analytics,
          }
        : NO_OPTIONS,
    [on, ym, transactions, capitalKeys, allTransactions, analytics]
  );

  return {
    on,
    ym,
    setYm,
    nowYm,
    firstYm,
    transactions,
    narrowed,
    filteredOut: on && analytics.length > 0 && transactions.length === 0,
    capitalKeys,
    capitalKnown,
    options,
  };
}
