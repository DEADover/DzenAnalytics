import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseHandlerDataParam } from "recharts";

/**
 * Выделение отрезка на графике протяжкой мыши: зажали на одной дате, отпустили
 * на другой — отрезок выбран. Щелчок без протяжки или Esc выделение снимают.
 *
 * Хранится по датам, а не по номерам точек: при смене периода номера
 * съезжают, а дата либо осталась на графике, либо выделение само пропадает.
 *
 * Обработчики вешаются на график Recharts (`onMouseDown` и т. д.), подпись
 * берётся из `activeLabel` — это значение оси X, то есть дата.
 */
export function useChartRangeSelect(keys: readonly string[]) {
  const [anchor, setAnchor] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [range, setRange] = useState<[string, string] | null>(null);
  const dragging = anchor !== null;
  // Свежие значения для слушателя на окне: отпустить кнопку можно и за краем графика.
  const latest = useRef({ anchor, hover });
  useEffect(() => {
    latest.current = { anchor, hover };
  });

  const labelOf = (state: MouseHandlerDataParam | undefined) =>
    state?.activeLabel != null ? String(state.activeLabel) : null;

  const finish = useCallback(() => {
    const { anchor: a, hover: h } = latest.current;
    if (a === null) return;
    setRange(h !== null && h !== a ? [a, h] : null);
    setAnchor(null);
    setHover(null);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    window.addEventListener("mouseup", finish);
    return () => window.removeEventListener("mouseup", finish);
  }, [dragging, finish]);

  const clear = useCallback(() => {
    setRange(null);
    setAnchor(null);
    setHover(null);
  }, []);

  const keySet = useMemo(() => new Set(keys), [keys]);
  /** Выбранный отрезок — или тот, что тянут прямо сейчас. */
  const active = useMemo<[string, string] | null>(() => {
    if (anchor !== null) return hover !== null && hover !== anchor ? [anchor, hover] : null;
    return range && keySet.has(range[0]) && keySet.has(range[1]) ? range : null;
  }, [anchor, hover, range, keySet]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") clear();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, clear]);

  const handlers = {
    onMouseDown: (state: MouseHandlerDataParam) => {
      const key = labelOf(state);
      if (key === null) return;
      setAnchor(key);
      setHover(key);
    },
    onMouseMove: (state: MouseHandlerDataParam) => {
      if (!dragging) return;
      const key = labelOf(state);
      if (key !== null) setHover(key);
    },
  };

  return { active, dragging, handlers, clear };
}
