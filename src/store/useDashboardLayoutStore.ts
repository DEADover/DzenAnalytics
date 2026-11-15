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
  dropIntoGap,
  moveWidgetBefore,
  removeWidget,
  setRowLinks,
  setWidgetOffBalance,
  setWidgetHidden,
  setWidgetView,
  shiftWidget,
  HOME_BOARD,
  OVERVIEW_BOARD,
  type LayoutBoard,
  type WidgetPlacement,
} from "../lib/dashboardLayout";

interface State {
  /** Какая это страница: её стандартная раскладка и набор виджетов. */
  board: LayoutBoard;
  layout: WidgetPlacement[];
  loaded: boolean;
  /** Идёт настройка раскладки: у виджетов появляются ручки. */
  editing: boolean;
  hydrate: () => Promise<void>;
  setEditing: (on: boolean) => void;
  move: (dragKey: string, overKey: string) => Promise<void>;
  /** Поставить виджет перед другим; `null` — в конец. */
  moveBefore: (dragKey: string, beforeKey: string | null) => Promise<void>;
  /** Бросок в пустую клетку: виджет встаёт ровно в неё. */
  dropInGap: (dragKey: string, beforeKey: string | null, gapCol: number) => Promise<void>;
  shift: (key: string, dir: -1 | 1) => Promise<void>;
  setHidden: (key: string, hidden: boolean, beforeKey?: string | null) => Promise<void>;
  /** Завести новую дорожку кнопок. */
  addLinks: (beforeKey?: string | null) => Promise<void>;
  /** Убрать из раскладки насовсем — только то, что человек сам завёл. */
  remove: (key: string) => Promise<void>;
  /** Выбрать вариант оформления виджета. */
  setView: (key: string, view: string) => Promise<void>;
  /** Счета вне баланса в «Балансах счетов»; `undefined` — как в «Расчётах». */
  setOffBalance: (key: string, value: boolean | undefined) => Promise<void>;
  /** Задать набор кнопок дорожки. */
  setLinks: (key: string, links: readonly (string | null)[]) => Promise<void>;
  reset: () => Promise<void>;
  /** Заменить раскладку целиком — пришедшую с другого устройства. Чужое и
   *  незнакомое отсекает та же нормализация, что и при чтении с диска. */
  replaceLayout: (raw: unknown) => Promise<void>;
}

export type LayoutState = State;

/**
 * Хранилище раскладки одной страницы с виджетами. Страниц две — главная и
 * «Обзор месяца»: набор виджетов и стандартный порядок у каждой свои, а всё
 * остальное (перестановка, снятие, запись на диск) одно и то же.
 */
function createLayoutStore(key: string, board: LayoutBoard) {
  return create<State>((set, get) => {
  const apply = async (layout: WidgetPlacement[]) => {
    set({ layout });
    await db.saveJSON(key, { layout });
  };

  return {
    board,
    layout: defaultLayout(board),
    loaded: false,
    editing: false,

    hydrate: async () => {
      const stored = await db.loadJSON<{ layout?: unknown }>(key);
      set({ layout: layoutFromStored(stored?.layout, board), loaded: true });
    },

    setEditing: (on) => set({ editing: on }),

    move: (dragKey, overKey) => apply(moveWidget(get().layout, dragKey, overKey)),
    moveBefore: (dragKey, beforeKey) =>
      apply(moveWidgetBefore(get().layout, dragKey, beforeKey)),
    dropInGap: (dragKey, beforeKey, gapCol) =>
      apply(dropIntoGap(get().layout, dragKey, beforeKey, gapCol)),
    shift: (key, dir) => apply(shiftWidget(get().layout, key, dir)),
    setHidden: (key, hidden, beforeKey = null) =>
      apply(setWidgetHidden(get().layout, key, hidden, beforeKey)),
    addLinks: (beforeKey = null) => apply(addLinksRow(get().layout, beforeKey)),
    remove: (key) => apply(removeWidget(get().layout, key)),
    setView: (key, view) => apply(setWidgetView(get().layout, key, view)),
    setLinks: (key, links) => apply(setRowLinks(get().layout, key, links)),
    setOffBalance: (key, value) => apply(setWidgetOffBalance(get().layout, key, value)),
    reset: () => apply(defaultLayout(board)),
    replaceLayout: (raw) => apply(layoutFromStored(raw, board)),
  };
  });
}

export type LayoutStore = ReturnType<typeof createLayoutStore>;

export const useDashboardLayoutStore = createLayoutStore("dashboardLayout", HOME_BOARD);
export const useOverviewLayoutStore = createLayoutStore("overviewLayout", OVERVIEW_BOARD);
