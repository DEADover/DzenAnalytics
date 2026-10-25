import { useEffect, useMemo } from "react";
import { useDataStore } from "../store/useDataStore";
import { useSlicesStore, activeSlice } from "../store/useSlicesStore";
import { useOffBalanceExcluded } from "./useInBalanceTransactions";
import { useAccountDirectory } from "./useAccountDirectory";
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
  const offBalanceKeys = useOffBalanceExcluded();
  const dir = useAccountDirectory();

  useEffect(() => {
    if (!exclLoaded) hydrateExcl();
  }, [exclLoaded, hydrateExcl]);


  const excluded = useMemo(
    () => new Set(slice.excludedCategories),
    [slice.excludedCategories]
  );
  // Счета разреза и внебалансовые складываются: и то и другое — «эти деньги в
  // картину не входят», разделять их в селекторе незачем.
  const skipAccounts = useMemo(() => {
    const out = dir.resolve(slice.excludedAccounts);
    if (offBalanceKeys) for (const t of offBalanceKeys) out.add(t);
    return out.size ? out : undefined;
  }, [slice.excludedAccounts, offBalanceKeys, dir]);

  return useMemo(
    () => stripFromAnalytics(transactions, { excludedCategories: excluded, offBalanceKeys: skipAccounts }),
    [transactions, excluded, skipAccounts]
  );
}
