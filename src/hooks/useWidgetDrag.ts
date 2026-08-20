/**
 * Состояние одного жеста перетаскивания на главной: кого везут и над кем
 * держат.
 *
 * Живёт в странице, а не в хранилище: на диск такому незачем, а после того как
 * плитку отпустили, от него не остаётся ничего.
 */

import { useEffect, useState } from "react";

export function useWidgetDrag(
  onMove: (dragKey: string, overKey: string) => void,
  /** Бросок в дырку: встать перед этим виджетом; `null` — в самый конец. */
  onMoveBefore: (dragKey: string, beforeKey: string | null) => void
) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  // Пока плитку везут, страница едет сама у краёв экрана.
  //
  // Штатное перетаскивание страницу не прокручивает: виджет из подвала нельзя
  // было донести до верха — курсор упирался в край окна, и всё. Скорость растёт
  // по мере приближения к краю, так что у самой кромки лист идёт быстро, а
  // рядом с ней — медленно и точно.
  useEffect(() => {
    if (!dragKey) return;
    const EDGE = 96; // высота полосы у края, в которой начинается прокрутка
    const MAX = 24; // пикселей за кадр у самой кромки
    let speed = 0;
    let raf = 0;
    const tick = () => {
      if (speed !== 0) window.scrollBy(0, speed);
      raf = requestAnimationFrame(tick);
    };
    const onOver = (e: globalThis.DragEvent) => {
      const y = e.clientY;
      const h = window.innerHeight;
      if (y < EDGE) speed = -Math.ceil(((EDGE - y) / EDGE) * MAX);
      else if (y > h - EDGE) speed = Math.ceil(((y - (h - EDGE)) / EDGE) * MAX);
      else speed = 0;
    };
    window.addEventListener("dragover", onOver);
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("dragover", onOver);
      cancelAnimationFrame(raf);
    };
  }, [dragKey]);

  return {
    dragKey,
    overKey,
    start: (key: string) => {
      setDragKey(key);
      setOverKey(null);
    },
    enter: (key: string) => setOverKey(key),
    end: () => {
      setDragKey(null);
      setOverKey(null);
    },
    dropBefore: (sourceKey: string, beforeKey: string | null) => {
      setDragKey(null);
      setOverKey(null);
      if (sourceKey === beforeKey) return;
      onMoveBefore(sourceKey, beforeKey);
    },
    drop: (sourceKey: string, targetKey: string) => {
      setDragKey(null);
      setOverKey(null);
      // На главную можно уронить что угодно — файл, ссылку, кусок текста.
      // Что это не наша плитка, разберётся тот, кто двигает: неизвестный ключ
      // раскладку не меняет.
      if (sourceKey === targetKey) return;
      onMove(sourceKey, targetKey);
    },
  };
}
