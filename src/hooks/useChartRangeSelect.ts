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

  // Последняя дата под мышью и запланированный кадр — см. `onMouseMove`.
  const pending = useRef<string | null>(null);
  /** Нажатие запоминается сразу, а не после перерисовки: при быстрой
   *  протяжке первые движения мыши приходили раньше неё и терялись. */
  const down = useRef<string | null>(null);
  const frame = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    []
  );

  const labelOf = (state: MouseHandlerDataParam | undefined) =>
    state?.activeLabel != null ? String(state.activeLabel) : null;

  const finish = useCallback(() => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    const a = down.current ?? latest.current.anchor;
    down.current = null;
    // Последнее положение мыши могло ещё не дойти до состояния — берём его.
    const h = pending.current ?? latest.current.hover;
    pending.current = null;
    if (a === null) return;
    setRange(h !== null && h !== a ? [a, h] : null);
    setAnchor(null);
    setHover(null);
  }, []);

  // Отпускание слушаем с самого нажатия (см. `onMouseDown`), а не после
  // перерисовки — иначе быстрый щелчок оставлял протяжку «зависшей».
  useEffect(() => () => window.removeEventListener("mouseup", finish), [finish]);

  const clear = useCallback(() => {
    down.current = null;
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
      pending.current = null;
      down.current = key;
      window.addEventListener("mouseup", finish, { once: true });
      setAnchor(key);
      setHover(key);
    },
    onMouseMove: (state: MouseHandlerDataParam) => {
      if (down.current === null && !dragging) return;
      const key = labelOf(state);
      if (key === null) return;
      // Не чаще кадра: мышь присылает событие на каждый пиксель, а каждое
      // обновление перерисовывает страницу с графиком на тысячи точек.
      pending.current = key;
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        if (pending.current !== null) setHover(pending.current);
      });
    },
  };

  return { active, dragging, handlers, clear };
}
