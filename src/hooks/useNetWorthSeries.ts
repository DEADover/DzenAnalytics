import { useMemo } from "react";
import type { Transaction } from "../types";
import { netWorthSeries, netWorthBasis } from "../lib/aggregations";
import { useDataStore } from "../store/useDataStore";
import { useCalibrationStore } from "../store/useCalibrationStore";
import { useOffBalanceStore } from "../store/useOffBalanceStore";
import { useLiveAccounts } from "./useLiveAccounts";

/**
 * Net-worth series corrected for account opening balances (issue #3).
 *
 * In API mode each account's `startBalance` is seeded at its opening date, so
 * the curve reflects initial capital from the right moment — no artificial dip
 * into the negative early in history — and ends exactly at the real total
 * (matching FIRE / «Совокупный баланс»). CSV mode (no live cache) falls back to
 * the manual calibration offset.
 */
export function useNetWorthSeries(
  txs: Transaction[]
): { date: string; net: number }[] {
  const rates = useDataStore((s) => s.rates);
  const calibration = useCalibrationStore((s) => s.calibration);
  const includeOffBalance = useOffBalanceStore((s) => s.includeOffBalance);
  const liveAccounts = useLiveAccounts();


  return useMemo(() => {
    if (liveAccounts && liveAccounts.length > 0) {
      const basis = netWorthBasis(liveAccounts, txs, rates, includeOffBalance);
      // Конец кривой прибиваем к сумме реальных остатков: форма — из операций,
      // конец — из правды. Без этого копилось всё, чего операции не объясняют,
      // — прежде всего валютная переоценка (стартовые остатки переводятся по
      // сегодняшнему курсу, а операции по курсу ЦБ на дату операции).
      //
      // Ручную калибровку здесь НЕ применяем, хотя в CSV-режиме она главнее.
      // Её и предлагают только без подключённого Дзен-мани — она нужна там, где
      // реальных остатков взять негде. Когда остатки есть, старая калибровка
      // молча прибивала кривую к устаревшему числу: у одного аккаунта она
      // осталась с прежних времён и держала итог на 1 492 ₽ ниже настоящего,
      // ровно на остаток закрытого счёта.
      //
      // Прежняя причина не пускать сюда `null` («кривая прыгала с верного
      // калиброванного значения на завышенное») ушла вместе с привязкой: теперь
      // без калибровки конец кривой и есть сумма остатков.
      return netWorthSeries(txs, null, { ...basis, anchorTo: basis.total });
    }
    // CSV / no cache — keep the manual-calibration behaviour.
    return netWorthSeries(txs, calibration);
  }, [txs, liveAccounts, rates, includeOffBalance, calibration]);
}
