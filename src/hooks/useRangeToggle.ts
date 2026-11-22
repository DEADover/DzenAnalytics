import { useCallback, useRef } from "react";
import { applyRangeToggle, type SelectGesture } from "../lib/rangeSelection";

/**
 * Переключатель строки для списков с выделением: обычный клик — одна строка,
 * Shift — диапазон от предыдущей. Сам набор живёт у списка.
 *
 * Точка отсчёта меняется снаружи функции обновления: React в строгом режиме
 * вызывает её дважды, и второй вызов считал бы уже от новой точки.
 */
export function useRangeToggle(
  order: readonly string[],
  update: (fn: (prev: Set<string>) => Set<string>) => void
) {
  const anchor = useRef<string | null>(null);
  return useCallback(
    (id: string, gesture?: SelectGesture) => {
      const from = anchor.current;
      anchor.current = id;
      update((prev) => applyRangeToggle(prev, order, from, id, gesture?.shift === true));
    },
    [order, update]
  );
}
