/**
 * Данные виджета «Свободные деньги» (issue #96).
 *
 * Хук только СОБИРАЕТ: остатки счетов, планы Дзен-мани и факт периода. Вся
 * арифметика живёт в `lib/freeMoney` и покрыта тестами — сюда её тащить нельзя,
 * иначе проверить расчёт можно будет только глазами на главной.
 */

import { useMemo, useSyncExternalStore } from "react";
import { peekZenCache, subscribeZenCache } from "../lib/zenCacheMemo";
import { useZenPlanned } from "./useZenPlanned";
import { usePlannedDeletionsStore } from "../store/usePlannedDeletionsStore";
import { useFreeMoneyStore } from "../store/useFreeMoneyStore";
import { useDataStore } from "../store/useDataStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { periodRange, spanDays } from "../lib/period";
import { expenseDelta } from "../lib/txKindStyle";
import {
  allowanceRatio,
  dailyAllowance,
  discretionarySpent,
  freeBreakdown,
  plannedSums,
  spendableAccounts,
  type DailyAllowance,
  type DailyMethod,
  type FreeBreakdown,
  type PlannedSums,
  type SpendableAccount,
} from "../lib/freeMoney";

export interface FreeMoneyModel {
  /** Счёт хотя бы один и остатки известны — иначе виджету нечего показывать. */
  ready: boolean;
  breakdown: FreeBreakdown;
  planned: PlannedSums;
  allowance: DailyAllowance;
  /** Доля дневного лимита, которая ещё цела, — для кольца. */
  ratio: number;
  method: DailyMethod;
  /** Названия счетов, попавших в расчёт: виджет объясняет, что он сложил. */
  accounts: string[];
  /** Потрачено с начала периода по этим счетам — всё, вместе с планами. */
  spent: number;
  /** Сколько из этого ушло на проведённые плановые платежи. */
  spentOnPlans: number;
  daysTotal: number;
  dayIndex: number;
  daysLeft: number;
  periodEnd: string;
}

export function useFreeMoney(
  accounts: SpendableAccount[],
  ym: string,
  today: string,
  /** Остатки настоящие, а не сальдо по операциям. В режиме CSV — `false`. */
  hasRealBalances: boolean
): FreeMoneyModel {
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);
  const method = useFreeMoneyStore((s) => s.method);
  const reserve = useFreeMoneyStore((s) => s.reserve);
  const transactions = useDataStore((s) => s.transactions);
  const plannedDeletions = usePlannedDeletionsStore((s) => s.deletions);

  const range = useMemo(
    () => periodRange(ym, monthStartDay),
    [ym, monthStartDay]
  );

  // Просроченные берём: платёж с прошедшей датой никуда не делся, и деньги на
  // него всё ещё нужны. Прогнозы отсеет `plannedSums` — здесь их не отфильтровать
  // раньше, чем понадобится, без потери исходных данных.
  const plannedAll = useZenPlanned(today, range.to, true);

  const mine = useMemo(() => spendableAccounts(accounts), [accounts]);
  const titles = useMemo(() => new Set(mine.map((a) => a.title)), [mine]);

  const onAccounts = useMemo(
    () => mine.reduce((sum, a) => sum + a.balanceBase, 0),
    [mine]
  );

  const planned = useMemo(() => {
    // Снятое вручную и ещё не уехавшее в облако не считаем: человек уже сказал,
    // что платежа не будет, и держать его в расчёте значило бы спорить с ним.
    const legs = (plannedAll ?? [])
      .filter((p) => plannedDeletions[p.id] === undefined)
      .map((p) => ({
        date: p.date,
        kind: p.kind,
        amountBase: p.amountBase,
        account: p.account,
        forecast: p.forecast,
      }));
    return plannedSums(legs, range.to, today, titles);
  }, [plannedAll, plannedDeletions, range.to, today, titles]);

  // Какие операции исполнили план. Ссылка `reminderMarker` живёт только в сыром
  // кэше Дзен-мани: в наших операциях этого поля нет, а заводить его ради одного
  // виджета значит тащить чужое поле через типы, снимки и бэкапы.
  const cache = useSyncExternalStore(subscribeZenCache, peekZenCache, peekZenCache);
  const planTxIds = useMemo(() => {
    const out = new Set<string>();
    for (const t of cache?.transactions ?? []) {
      if (t.deleted || !t.reminderMarker) continue;
      out.add(String(t.id));
    }
    return out;
  }, [cache]);

  // Потрачено с начала периода — только по учитываемым счетам: расход со вклада
  // не участвует в остатке, значит не должен участвовать и в бюджете периода.
  // Возвраты вычитаются (`expenseDelta`), переводы не считаются вовсе.
  //
  // Считаем двумя вёдрами: всё и отдельно то, что ушло по планам. Дневной лимит
  // строится по свободным тратам — иначе списавшаяся аренда возвращалась бы в
  // бюджет периода и в день платежа поднимала бы лимит.
  const { spent, spentOnPlans } = useMemo(() => {
    let all = 0;
    let onPlans = 0;
    for (const t of transactions) {
      if (t.date < range.from || t.date > today) continue;
      if (!titles.has(t.outcomeAccount)) continue;
      const delta = expenseDelta(t);
      all += delta;
      if (planTxIds.has(t.id)) onPlans += delta;
    }
    return { spent: all, spentOnPlans: onPlans };
  }, [transactions, range.from, today, titles, planTxIds]);

  const freeSpent = discretionarySpent(spent, spentOnPlans);

  const daysTotal = spanDays(range.from, range.to);
  const dayIndex = Math.min(daysTotal, Math.max(1, spanDays(range.from, today)));

  const breakdown = useMemo(
    () => freeBreakdown({ onAccounts, planned, reserve }),
    [onAccounts, planned, reserve]
  );

  const allowance = useMemo(
    () =>
      dailyAllowance({
        method,
        free: breakdown.free,
        daysTotal,
        dayIndex,
        spent: freeSpent,
      }),
    [method, breakdown.free, daysTotal, dayIndex, freeSpent]
  );

  return {
    // Без настоящих остатков считать нечего: сальдо по операциям — это сколько
    // через счёт прошло, а не сколько на нём лежит.
    ready: hasRealBalances && mine.length > 0,
    breakdown,
    planned,
    allowance,
    ratio: allowanceRatio(allowance),
    method,
    accounts: mine.map((a) => a.title),
    spent,
    spentOnPlans,
    daysTotal,
    dayIndex,
    daysLeft: Math.max(0, daysTotal - dayIndex + 1),
    periodEnd: range.to,
  };
}
