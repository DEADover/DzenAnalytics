import { useEffect } from "react";
import { useDataStore } from "../store/useDataStore";
import { useSlicesStore, activeSlice } from "../store/useSlicesStore";
import { useLoanAccountKeys, useOffBalanceExcluded } from "./useInBalanceTransactions";
import { useAccountDirectory } from "./useAccountDirectory";
import { stripFromAnalytics } from "../lib/aggregations";
import { memoLast } from "../lib/memoLast";
import type { AccountDirectory } from "../lib/accountDirectory";
import type { Transaction } from "../types";

// Общие на модуль — на главной и в разделах хук стоит в нескольких
// компонентах сразу (см. `memoLast`).
const excludedSetOf = memoLast((categories: readonly string[]) => new Set(categories));

// Счета разреза и внебалансовые складываются: и то и другое — «эти деньги в
// картину не входят», разделять их в селекторе незачем.
const skipAccountsOf = memoLast(
  (excludedAccounts: readonly string[], offBalanceKeys: Set<string> | undefined, dir: AccountDirectory) => {
    const out = dir.resolve(excludedAccounts);
    if (offBalanceKeys) for (const t of offBalanceKeys) out.add(t);
    return out.size ? out : undefined;
  }
);

const analyticsOf = memoLast(
  (
    transactions: Transaction[],
    excludedCategories: Set<string>,
    offBalanceKeys: Set<string> | undefined,
    loanKeys: Set<string> | undefined,
    dir: AccountDirectory
  ) =>
    stripFromAnalytics(transactions, { excludedCategories, offBalanceKeys, loanKeys, labelOf: dir.label })
);

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
  const loanKeys = useLoanAccountKeys();
  const dir = useAccountDirectory();

  useEffect(() => {
    if (!exclLoaded) hydrateExcl();
  }, [exclLoaded, hydrateExcl]);


  const excluded = excludedSetOf(slice.excludedCategories);
  const skipAccounts = skipAccountsOf(slice.excludedAccounts, offBalanceKeys, dir);
  return analyticsOf(transactions, excluded, skipAccounts, loanKeys, dir);
}
