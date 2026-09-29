import { useMemo } from "react";
import type { Transaction } from "../types";
import { netWorthSeries, stackedBalanceByAccount } from "../lib/aggregations";
import { useCalibrationStore } from "../store/useCalibrationStore";
import { useDraftsStore } from "../store/useDraftsStore";
import { useBalanceValuation } from "./useBalanceValuation";

/**
 * «Совокупный баланс» на каждый день — сумма остатков счетов «в балансе».
 *
 * С подключённым Дзен-мани это сумма тех же линий, что и в «Остатках по
 * счетам» (`stackedBalanceByAccount` с оценкой по правилам Дзен-мани): каждый
 * счёт в своей валюте по курсу дня, начальный остаток — с начала истории.
 * Прежде кривая собиралась отдельно — из потока в рублях и начальных остатков
 * с датой первой операции, а потом целиком сдвигалась к сегодняшнему итогу, и
 * всё, чего она не объясняла (вклады, валюта), ложилось на всю историю разом.
 *
 * Без Дзен-мани (CSV) остатков нет — кривая от нуля с ручной калибровкой.
 */
export function useNetWorthSeries(
  txs: Transaction[]
): { date: string; net: number }[] {
  const calibration = useCalibrationStore((s) => s.calibration);
  const drafts = useDraftsStore((s) => s.drafts);
  const valuation = useBalanceValuation();

  return useMemo(() => {
    if (valuation) {
      const titles = [...(valuation.universe ?? [])];
      if (titles.length === 0) return [];
      const { series } = stackedBalanceByAccount(
        txs,
        0,
        null,
        new Set(Object.keys(drafts)),
        titles,
        null,
        valuation
      );
      return series.map((p) => ({ date: p.date, net: p.total }));
    }
    return netWorthSeries(txs, calibration);
  }, [txs, valuation, drafts, calibration]);
}
