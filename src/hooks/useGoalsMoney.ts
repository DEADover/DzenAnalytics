/**
 * Деньги для целей: живые счета, курсы на сегодня и средний темп сбережений.
 *
 * Общий для страницы «Цели» и виджета целей на главной — по этим данным
 * `goalMetrics` считает прогресс и срок.
 */

import { useEffect, useMemo, useState } from "react";
import type { Transaction } from "../types";
import { useDataStore } from "../store/useDataStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { getLiveAccountsFromCache } from "../store/useZenmoneyStore";
import { groupByMonth } from "../lib/aggregations";
import { getHistoricalRubRate } from "../lib/historicalRates";
import { currenciesToQuote, type GoalAccount, type RubRates } from "../lib/goals";
import type { Money } from "../lib/goalMetrics";
import { localToday } from "../lib/period";
import { accountKeyOf } from "../lib/accountKey";
import { useAccountDirectory } from "./useAccountDirectory";

export function useGoalsMoney(transactions: Transaction[]) {
  const rates = useDataStore((s) => s.rates);
  // Household savings pace drives the default (fallback) forecast. Месяц здесь
  // отчётный: прогноз «когда накопится» опирается на тот же месяц, что и
  // остальная аналитика.
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);
  const months = useMemo(
    () => groupByMonth(transactions, { monthStartDay }),
    [transactions, monthStartDay]
  );
  const recent = months.slice(-6);
  const avgIncome = recent.length
    ? recent.reduce((s, m) => s + m.income, 0) / recent.length
    : 0;
  const avgExpense = recent.length
    ? recent.reduce((s, m) => s + m.expense, 0) / recent.length
    : 0;
  const avgSavings = avgIncome - avgExpense;

  // Живые счета — цель может копиться на них вместо ручной суммы (#45, #103).
  // Накопительные первыми: цель обычно ставят на них.
  const [accounts, setAccounts] = useState<GoalAccount[]>([]);
  useEffect(() => {
    let cancelled = false;
    getLiveAccountsFromCache().then((live) => {
      if (cancelled || !live) return;
      setAccounts(
        live
          .filter((a) => !a.archive)
          .map((a) => ({
            key: accountKeyOf(a),
            title: a.title,
            balance: a.balance,
            currency: a.currency,
            savings: a.savings,
          }))
          .sort(
            (a, b) => Number(b.savings) - Number(a.savings) || a.title.localeCompare(b.title)
          )
      );
    });
    return () => {
      cancelled = true;
    };
  }, [transactions]);

  // Курсы ЦБ на сегодня для валют счетов: цель — про то, сколько денег есть
  // сейчас, поэтому доллары на вкладе считаются по сегодняшнему курсу. Пока
  // курсы не пришли (или нет сети), пересчёт идёт по курсам из настроек.
  const quoteKey = currenciesToQuote(accounts, rates.base).join(",");
  const [cbr, setCbr] = useState<RubRates>({});
  useEffect(() => {
    if (!quoteKey) return;
    let cancelled = false;
    const date = localToday();
    Promise.all(
      quoteKey.split(",").map(async (c) => [c, (await getHistoricalRubRate(date, c))?.rate] as const)
    ).then((pairs) => {
      if (cancelled) return;
      const next: RubRates = {};
      for (const [c, r] of pairs) if (r != null) next[c] = r;
      setCbr(next);
    }, () => {});
    return () => {
      cancelled = true;
    };
  }, [quoteKey]);

  // Подписи — из справочника: у тёзок с уточнением.
  const dir = useAccountDirectory();
  const labeled = useMemo(
    () => accounts.map((a) => ({ ...a, label: dir.label(a.key ?? a.title) })),
    [accounts, dir]
  );
  const money = useMemo<Money>(() => ({ accounts: labeled, rates, cbr }), [labeled, rates, cbr]);
  return { accounts, labeled, cbr, money, avgSavings };
}
