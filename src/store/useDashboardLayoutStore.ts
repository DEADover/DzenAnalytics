/**
 * Раскладка главной страницы: порядок виджетов и то, какие из них убраны.
 *
 * Хранится своим блобом в IDB и в Дзен-мани не уезжает — это оформление
 * рабочего места, а не данные. Сама модель и все преобразования над ней живут
 * в `lib/dashboardLayout`; здесь только состояние, запись на диск и режим
 * настройки (он нарочно не сохраняется: страница должна открываться готовой к
 * чтению, а не к перестановке).
 */

import { create } from "zustand";
import * as db from "../lib/db";
import {
  DEFAULT_LAYOUT,
  moveWidget,
  normalizeLayout,
  setWidgetHidden,
  shiftWidget,
  type WidgetId,
  type WidgetPlacement,
} from "../lib/dashboardLayout";

const KEY = "dashboardLayout";

interface State {
  layout: WidgetPlacement[];
  loaded: boolean;
  /** Идёт настройка раскладки: у виджетов появляются ручки. */
  editing: boolean;
  hydrate: () => Promise<void>;
  setEditing: (on: boolean) => void;
  move: (dragId: WidgetId, overId: WidgetId) => Promise<void>;
  shift: (id: WidgetId, dir: -1 | 1) => Promise<void>;
  setHidden: (id: WidgetId, hidden: boolean) => Promise<void>;
  reset: () => Promise<void>;
}

export const useDashboardLayoutStore = create<State>((set, get) => {
  const apply = async (layout: WidgetPlacement[]) => {
    set({ layout });
    await db.saveJSON(KEY, { layout });
  };

  return {
    layout: DEFAULT_LAYOUT.slice(),
    loaded: false,
    editing: false,

    hydrate: async () => {
      const stored = await db.loadJSON<{ layout?: unknown }>(KEY);
      set({ layout: normalizeLayout(stored?.layout), loaded: true });
    },

    setEditing: (on) => set({ editing: on }),

    move: (dragId, overId) => apply(moveWidget(get().layout, dragId, overId)),
    shift: (id, dir) => apply(shiftWidget(get().layout, id, dir)),
    setHidden: (id, hidden) => apply(setWidgetHidden(get().layout, id, hidden)),
    reset: () => apply(DEFAULT_LAYOUT.slice()),
  };
});
