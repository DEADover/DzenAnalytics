import { useEffect, useMemo } from "react";
import { useLiveAccounts } from "./useLiveAccounts";
import { useDataStore } from "../store/useDataStore";
import { useFireStore } from "../store/useFireStore";
import { toBase } from "../lib/csv";
import {
  type LiveAccount,
} from "../store/useZenmoneyStore";

export interface FireCapitalAccount extends LiveAccount {
  balanceBase: number;
}

/**
 * The curated FIRE capital — Σ balances (base currency) of the accounts the
 * user counts toward financial independence (useFireStore excludes the rest).
 * A single source shared by the FIRE independence block AND the rolling FIRE
 * chart's anchor, so «месяцы жизни» on the chart and «% до FIRE» in the block
 * are computed from the exact same capital.
 */
export function useFireCapital(): {
  capital: number;
  capitalAccounts: FireCapitalAccount[];
} {
  const rates = useDataStore((s) => s.rates);
  const excluded = useFireStore((s) => s.excluded);
  const fireHydrate = useFireStore((s) => s.hydrate);
  const fireLoaded = useFireStore((s) => s.loaded);
  const accounts = useLiveAccounts();

  useEffect(() => {
    if (!fireLoaded) fireHydrate();
  }, [fireLoaded, fireHydrate]);

  const capitalAccounts = useMemo(() => {
    if (!accounts) return [];
    return accounts
      .filter((a) => !a.archive)
      .map((a) => ({ ...a, balanceBase: toBase(a.balance, a.currency, rates) }))
      .sort((a, b) => b.balanceBase - a.balanceBase);
  }, [accounts, rates]);

  const capital = useMemo(
    () =>
      capitalAccounts
        .filter((a) => !excluded.includes(a.title))
        .reduce((s, a) => s + a.balanceBase, 0),
    [capitalAccounts, excluded]
  );

  return { capital, capitalAccounts };
}
