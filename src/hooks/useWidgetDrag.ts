/**
 * Состояние одного жеста перетаскивания на главной: кого везут и над кем
 * держат.
 *
 * Живёт в странице, а не в хранилище: на диск такому незачем, а после того как
 * плитку отпустили, от него не остаётся ничего.
 */

import { useState } from "react";

export function useWidgetDrag(
  onMove: (dragKey: string, overKey: string) => void,
  /** Бросок в дырку: встать перед этим виджетом; `null` — в самый конец. */
  onMoveBefore: (dragKey: string, beforeKey: string | null) => void
) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

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
