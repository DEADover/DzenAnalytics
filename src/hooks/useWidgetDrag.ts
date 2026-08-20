/**
 * Состояние одного жеста перетаскивания на главной: кого везут и над кем
 * держат.
 *
 * Живёт в странице, а не в хранилище: на диск такому незачем, а после того как
 * плитку отпустили, от него не остаётся ничего.
 */

import { useState } from "react";
import { isWidgetId, type WidgetId } from "../lib/dashboardLayout";

export function useWidgetDrag(onMove: (dragId: WidgetId, overId: WidgetId) => void) {
  const [dragId, setDragId] = useState<WidgetId | null>(null);
  const [overId, setOverId] = useState<WidgetId | null>(null);

  return {
    dragId,
    overId,
    start: (id: WidgetId) => {
      setDragId(id);
      setOverId(null);
    },
    enter: (id: WidgetId) => setOverId(id),
    end: () => {
      setDragId(null);
      setOverId(null);
    },
    drop: (sourceId: string, targetId: WidgetId) => {
      setDragId(null);
      setOverId(null);
      // На главную можно уронить что угодно — файл, ссылку, кусок текста.
      // Двигаем только то, что и правда является нашим виджетом.
      if (!isWidgetId(sourceId) || sourceId === targetId) return;
      onMove(sourceId, targetId);
    },
  };
}
