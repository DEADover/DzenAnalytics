/**
 * Состояние одного жеста перетаскивания на главной: кого везут и над кем
 * держат.
 *
 * Живёт в странице, а не в хранилище: на диск такому незачем, а после того как
 * плитку отпустили, от него не остаётся ничего.
 */

import { useState } from "react";

export function useWidgetDrag(onMove: (dragKey: string, overKey: string) => void) {
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
