import { useMemo } from "react";
import { balanceKey, type BalanceValuation } from "../lib/aggregations";
import { makeRateAt } from "../lib/historicalRates";
import { toIsoDate } from "../lib/period";
import { useDataStore } from "../store/useDataStore";
import { useOffBalanceStore } from "../store/useOffBalanceStore";
import type { LiveAccount } from "../store/useZenmoneyStore";
import { useLiveAccounts } from "./useLiveAccounts";

/**
 * Оценка остатков по правилам Дзен-мани — одна на все графики остатков:
 * «Счета», главную и «Здоровье». Разойдись они, и «Совокупный баланс» на
 * одной странице не совпадал бы с тем же числом на другой.
 *
 * `accounts` — свои счета (например, с наложенными неотправленными правками);
 * не заданы — берутся из кэша Дзен-мани. `null` в ответе — Дзен-мани не
 * подключён, остатков нет (CSV).
 */
export function useBalanceValuation(
  accounts?: LiveAccount[] | null
): BalanceValuation | null {
  const cached = useLiveAccounts();
  const list = accounts !== undefined ? accounts : cached;
  const rates = useDataStore((s) => s.rates);
  const hist = useDataStore((s) => s.histDayRates);
  const includeOffBalance = useOffBalanceStore((s) => s.includeOffBalance);

  return useMemo(() => {
    if (!list || list.length === 0) return null;
    const balances: Record<string, number> = {};
    const universe = new Set<string>();
    for (const a of list) {
      const key = balanceKey(a.title, a.currency);
      balances[key] = (balances[key] || 0) + a.balance;
      // Архивные участвуют: закрытый счёт в прошлом держал настоящие деньги.
      if (a.inBalance || includeOffBalance) universe.add(a.title);
    }
    return {
      balances,
      universe,
      rateAt: makeRateAt(rates, hist, toIsoDate(new Date())),
    };
  }, [list, rates, hist, includeOffBalance]);
}
