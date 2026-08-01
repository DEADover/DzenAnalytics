import { useEffect, useMemo, useState } from "react";
import { useDataStore } from "../store/useDataStore";
import { useCalibrationStore } from "../store/useCalibrationStore";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { useOffBalanceStore } from "../store/useOffBalanceStore";
import { useSlicesStore, activeSlice } from "../store/useSlicesStore";
import {
  getLiveAccountsFromCache,
  type LiveAccount,
} from "../store/useZenmoneyStore";
import { computeHealthScore, type HealthScore } from "../lib/health";
import { stripFromAnalytics } from "../lib/aggregations";

/**
 * Financial-health score, computed the same way for every surface that shows it
 * (the /health page AND the dashboard hero). Extracted into a hook so the
 * off-balance-cushion logic and store wiring live in exactly one place.
 *
 * Off-balance accounts count toward the emergency fund even when they're hidden
 * from the headline net worth — but only when «include off-balance» is OFF,
 * otherwise the net-worth calibration already counts them (avoids double-count).
 */
export function useHealthScore(): HealthScore | null {
  const transactions = useDataStore((s) => s.transactions);
  const rates = useDataStore((s) => s.rates);
  const baseCurrency = rates.base;
  const calibration = useCalibrationStore((s) => s.calibration);
  const calibLoaded = useCalibrationStore((s) => s.loaded);
  const hydrateCalibration = useCalibrationStore((s) => s.hydrate);
  const categoryMeta = useCategoryMetaStore((s) => s.meta);
  const metaLoaded = useCategoryMetaStore((s) => s.loaded);
  const hydrateMeta = useCategoryMetaStore((s) => s.hydrate);
  const includeOffBalance = useOffBalanceStore((s) => s.includeOffBalance);
  const slices = useSlicesStore((s) => s.slices);
  const activeId = useSlicesStore((s) => s.activeId);
  const exclLoaded = useSlicesStore((s) => s.loaded);
  const hydrateExcl = useSlicesStore((s) => s.hydrate);
  const slice = activeSlice({ slices, activeId });
  const [liveAccounts, setLiveAccounts] = useState<LiveAccount[] | null>(null);

  useEffect(() => {
    if (!calibLoaded) hydrateCalibration();
    if (!metaLoaded) hydrateMeta();
    if (!exclLoaded) hydrateExcl();
  }, [calibLoaded, hydrateCalibration, metaLoaded, hydrateMeta, exclLoaded, hydrateExcl]);

  useEffect(() => {
    let cancelled = false;
    getLiveAccountsFromCache().then((d) => {
      if (!cancelled) setLiveAccounts(d);
    });
    return () => {
      cancelled = true;
    };
  }, [transactions]);

  return useMemo(() => {
    if (transactions.length === 0) return null;
    const toBase = (amt: number, cur: string) =>
      cur === rates.base ? amt : amt * (rates.rates[cur] || 1);
    const offBalance =
      includeOffBalance || !liveAccounts
        ? []
        : liveAccounts.filter((a) => !a.archive && !a.inBalance);
    const extraLiquid = offBalance.reduce(
      (s, a) => s + toBase(a.balance, a.currency),
      0
    );

    // Savings-rate / obligatory-share metrics ignore turnover + off-balance
    // flows the user excluded (#14). Emergency-fund cushion (extraLiquid) is a
    // BALANCE and stays untouched — off-balance accounts still count there.
    const skipAccounts = new Set(slice.excludedAccounts);
    for (const a of offBalance) skipAccounts.add(a.title);
    const scored = stripFromAnalytics(transactions, {
      excludedCategories: new Set(slice.excludedCategories),
      offBalanceTitles: skipAccounts.size ? skipAccounts : undefined,
    });

    return computeHealthScore({
      transactions: scored,
      baseCurrency,
      calibration,
      categoryMeta,
      extraLiquid,
    });
  }, [
    transactions,
    rates,
    baseCurrency,
    calibration,
    categoryMeta,
    includeOffBalance,
    liveAccounts,
    slice,
  ]);
}
