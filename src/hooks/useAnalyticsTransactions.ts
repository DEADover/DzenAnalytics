import { useEffect, useMemo, useState } from "react";
import { useDataStore } from "../store/useDataStore";
import { useOffBalanceStore } from "../store/useOffBalanceStore";
import { useAnalyticsExclusionStore } from "../store/useAnalyticsExclusionStore";
import {
  getLiveAccountsFromCache,
  type LiveAccount,
} from "../store/useZenmoneyStore";
import { stripFromAnalytics } from "../lib/aggregations";
import type { Transaction } from "../types";

/**
 * Transactions with the «не учитывать в аналитике» exclusions applied (issue
 * #14): categories the user marked as pure turnover / mutual-settlement, plus —
 * when «учитывать внебалансовые счета» is OFF — flows on off-balance accounts.
 *
 * The aggregate widgets that show a single «доход / расход / поток» picture
 * (Цели & FIRE, Здоровье, Что-Если, Год в цифрах, Дайджест) read raw
 * transactions directly, bypassing the global filter bar. This hook is the one
 * seam that pre-strips those operations, so the exclusion behaves consistently
 * everywhere without each page re-deriving it.
 *
 * Returns the SAME array reference when nothing is excluded (see
 * `stripFromAnalytics`), so it's safe to drop into a page's `useMemo` deps.
 */
export function useAnalyticsTransactions(): Transaction[] {
  const transactions = useDataStore((s) => s.transactions);
  const excluded = useAnalyticsExclusionStore((s) => s.excluded);
  const exclLoaded = useAnalyticsExclusionStore((s) => s.loaded);
  const hydrateExcl = useAnalyticsExclusionStore((s) => s.hydrate);
  const includeOffBalance = useOffBalanceStore((s) => s.includeOffBalance);
  const [liveAccounts, setLiveAccounts] = useState<LiveAccount[] | null>(null);

  useEffect(() => {
    if (!exclLoaded) hydrateExcl();
  }, [exclLoaded, hydrateExcl]);

  useEffect(() => {
    let cancelled = false;
    getLiveAccountsFromCache().then((d) => {
      if (!cancelled) setLiveAccounts(d);
    });
    return () => {
      cancelled = true;
    };
  }, [transactions]);

  // Off-balance titles matter only while «включить внебалансовые» is OFF (the
  // default) — otherwise those accounts count everywhere and we keep their flows.
  const offBalanceTitles = useMemo(() => {
    if (includeOffBalance || !liveAccounts) return undefined;
    const titles = liveAccounts
      .filter((a) => !a.archive && !a.inBalance)
      .map((a) => a.title);
    return titles.length ? new Set(titles) : undefined;
  }, [includeOffBalance, liveAccounts]);

  return useMemo(
    () => stripFromAnalytics(transactions, { excludedCategories: excluded, offBalanceTitles }),
    [transactions, excluded, offBalanceTitles]
  );
}
