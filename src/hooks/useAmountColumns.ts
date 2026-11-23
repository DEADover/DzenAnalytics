import { useMemo } from "react";
import { useDisplayStore } from "../store/useDisplayStore";
import type { ResizeColumn } from "./useColumnResize";

/** Ширина столбца «Сумма», когда рядом стоит пересчёт: «12 345,67 $ (1 111 111,11 ₽)». */
export const AMOUNT_WITH_BASE_WIDTH = "216px";

/**
 * Столбцы ленты с учётом настройки «Пересчёт в базовую валюту»: двум суммам в
 * одной строке нужно больше места. Своя ширина столбца, если человек её задал,
 * важнее — тогда пересчёт сам перейдёт на строку ниже.
 */
export function useAmountColumns(columns: readonly ResizeColumn[]): ResizeColumn[] {
  const on = useDisplayStore((s) => s.amountInBase);
  return useMemo(
    () => columns.map((c) => (on && c.key === "amount" ? { ...c, size: AMOUNT_WITH_BASE_WIDTH } : c)),
    [columns, on]
  );
}
