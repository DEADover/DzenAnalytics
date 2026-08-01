import { useEffect, useMemo, useState } from "react";
import { useDataStore } from "../store/useDataStore";
import { useOffBalanceStore } from "../store/useOffBalanceStore";
import { useSlicesStore, activeSlice } from "../store/useSlicesStore";
import {
  getLiveAccountsFromCache,
  type LiveAccount,
} from "../store/useZenmoneyStore";
import { stripFromAnalytics } from "../lib/aggregations";
import type { Transaction } from "../types";

/**
 * Операции активного РАЗРЕЗА (issue #14): без категорий и счетов, которые
 * пользователь вынес из аналитики, и — пока «учитывать внебалансовые счета»
 * выключено — без потоков по внебалансовым счетам.
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
  const slices = useSlicesStore((s) => s.slices);
  const activeId = useSlicesStore((s) => s.activeId);
  const exclLoaded = useSlicesStore((s) => s.loaded);
  const hydrateExcl = useSlicesStore((s) => s.hydrate);
  const slice = activeSlice({ slices, activeId });
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

  const excluded = useMemo(
    () => new Set(slice.excludedCategories),
    [slice.excludedCategories]
  );
  // Счета разреза и внебалансовые складываются: и то и другое — «эти деньги в
  // картину не входят», разделять их в селекторе незачем.
  const skipAccounts = useMemo(() => {
    const out = new Set(slice.excludedAccounts);
    if (offBalanceTitles) for (const t of offBalanceTitles) out.add(t);
    return out.size ? out : undefined;
  }, [slice.excludedAccounts, offBalanceTitles]);

  return useMemo(
    () => stripFromAnalytics(transactions, { excludedCategories: excluded, offBalanceTitles: skipAccounts }),
    [transactions, excluded, skipAccounts]
  );
}
