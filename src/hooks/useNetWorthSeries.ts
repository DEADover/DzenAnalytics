import { useMemo } from "react";
import type { Transaction } from "../types";
import { netWorthSeries, netWorthBasis } from "../lib/aggregations";
import { useDataStore } from "../store/useDataStore";
import { useCalibrationStore } from "../store/useCalibrationStore";
import { useOffBalanceStore } from "../store/useOffBalanceStore";
import { useDraftsStore } from "../store/useDraftsStore";
import { useLiveAccounts } from "./useLiveAccounts";

/**
 * Net-worth series corrected for account opening balances (issue #3).
 *
 * In API mode each account is reconstructed and reconciled separately from its
 * opening date, so a later account cannot shift the earlier history. The curve
 * ends exactly at the real total (plus unsynced drafts). CSV mode (no live
 * cache) falls back to the manual calibration offset.
 */
export function useNetWorthSeries(
  txs: Transaction[]
): { date: string; net: number }[] {
  const rates = useDataStore((s) => s.rates);
  const calibration = useCalibrationStore((s) => s.calibration);
  const includeOffBalance = useOffBalanceStore((s) => s.includeOffBalance);
  const liveAccounts = useLiveAccounts();
  const drafts = useDraftsStore((s) => s.drafts);
  const unsyncedIds = useMemo(() => new Set(Object.keys(drafts)), [drafts]);

  return useMemo(() => {
    if (liveAccounts && liveAccounts.length > 0) {
      const basis = netWorthBasis(liveAccounts, txs, rates, includeOffBalance);
      // Каждый счёт привязываем отдельно и только с даты его появления. Общая
      // поправка ко всей линии применяла расхождение позднего счёта к ранним
      // годам и могла увести начало совокупного графика в минус.
      //
      // Ручную калибровку здесь НЕ применяем, хотя в CSV-режиме она главнее.
      // Её и предлагают только без подключённого Дзен-мани — она нужна там, где
      // реальных остатков взять негде. Когда остатки есть, старая калибровка
      // молча прибивала кривую к устаревшему числу: у одного аккаунта она
      // осталась с прежних времён и держала итог на 1 492 ₽ ниже настоящего,
      // ровно на остаток закрытого счёта.
      //
      // Черновики уже находятся в `txs`, но API-остатки их ещё не содержат:
      // исключаем их только из сверки якоря, оставляя в форме и конце линии.
      return netWorthSeries(txs, null, { ...basis, unsyncedIds });
    }
    // CSV / no cache — keep the manual-calibration behaviour.
    return netWorthSeries(txs, calibration);
  }, [txs, liveAccounts, rates, includeOffBalance, calibration, unsyncedIds]);
}
