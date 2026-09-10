/**
 * Данные виджета «Свободные деньги» (issue #96).
 *
 * Хук только СОБИРАЕТ: остатки счетов, планы Дзен-мани и факт периода. Вся
 * арифметика живёт в `lib/freeMoney` и покрыта тестами — сюда её тащить нельзя,
 * иначе проверить расчёт можно будет только глазами на главной.
 */

import { useMemo } from "react";
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
  /** Потрачено с начала периода по этим счетам. */
  spent: number;
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

  // Потрачено с начала периода — только по учитываемым счетам: расход со вклада
  // не участвует в остатке, значит не должен участвовать и в бюджете периода.
  // Возвраты вычитаются (`expenseDelta`), переводы не считаются вовсе.
  const spent = useMemo(() => {
    let sum = 0;
    for (const t of transactions) {
      if (t.date < range.from || t.date > today) continue;
      if (!titles.has(t.outcomeAccount)) continue;
      sum += expenseDelta(t);
    }
    return sum;
  }, [transactions, range.from, today, titles]);

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
        spent,
      }),
    [method, breakdown.free, daysTotal, dayIndex, spent]
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
    daysTotal,
    dayIndex,
    daysLeft: Math.max(0, daysTotal - dayIndex + 1),
    periodEnd: range.to,
  };
}
