/**
 * Раскладка главной страницы: порядок виджетов, какие из них убраны и что стоит
 * на дорожках кнопок.
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
  addLinksRow,
  defaultLayout,
  layoutFromStored,
  moveWidget,
  moveWidgetBefore,
  removeWidget,
  setRowLinks,
  setWidgetHidden,
  setWidgetView,
  shiftWidget,
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
  move: (dragKey: string, overKey: string) => Promise<void>;
  /** Поставить виджет перед другим; `null` — в конец. Так работает бросок в дырку. */
  moveBefore: (dragKey: string, beforeKey: string | null) => Promise<void>;
  shift: (key: string, dir: -1 | 1) => Promise<void>;
  setHidden: (key: string, hidden: boolean) => Promise<void>;
  /** Завести новую дорожку кнопок. */
  addLinks: () => Promise<void>;
  /** Убрать из раскладки насовсем — только то, что человек сам завёл. */
  remove: (key: string) => Promise<void>;
  /** Выбрать вариант оформления виджета. */
  setView: (key: string, view: string) => Promise<void>;
  /** Задать набор кнопок дорожки. */
  setLinks: (key: string, links: readonly (string | null)[]) => Promise<void>;
  reset: () => Promise<void>;
}

export const useDashboardLayoutStore = create<State>((set, get) => {
  const apply = async (layout: WidgetPlacement[]) => {
    set({ layout });
    await db.saveJSON(KEY, { layout });
  };

  return {
    layout: defaultLayout(),
    loaded: false,
    editing: false,

    hydrate: async () => {
      const stored = await db.loadJSON<{ layout?: unknown }>(KEY);
      set({ layout: layoutFromStored(stored?.layout), loaded: true });
    },

    setEditing: (on) => set({ editing: on }),

    move: (dragKey, overKey) => apply(moveWidget(get().layout, dragKey, overKey)),
    moveBefore: (dragKey, beforeKey) =>
      apply(moveWidgetBefore(get().layout, dragKey, beforeKey)),
    shift: (key, dir) => apply(shiftWidget(get().layout, key, dir)),
    setHidden: (key, hidden) => apply(setWidgetHidden(get().layout, key, hidden)),
    addLinks: () => apply(addLinksRow(get().layout)),
    remove: (key) => apply(removeWidget(get().layout, key)),
    setView: (key, view) => apply(setWidgetView(get().layout, key, view)),
    setLinks: (key, links) => apply(setRowLinks(get().layout, key, links)),
    reset: () => apply(defaultLayout()),
  };
});
