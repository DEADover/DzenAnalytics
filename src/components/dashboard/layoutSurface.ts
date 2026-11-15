/**
 * Страница с настраиваемыми виджетами: где лежит её раскладка и как она
 * называется в подписях.
 *
 * Таких страниц две — главная и «Обзор месяца». Механизм настройки у них один
 * (`WidgetBoard`, `WidgetShell`, список «поставить сюда»), а хранилище и слова
 * свои: «Убрать с главной» на «Обзоре» звучало бы ошибкой.
 */

import { createContext, useContext } from "react";
import {
  useDashboardLayoutStore,
  useOverviewLayoutStore,
  type LayoutStore,
} from "../../store/useDashboardLayoutStore";

export interface LayoutSurface {
  useStore: LayoutStore;
  /** Подпись крестика у виджета. */
  removeLabel: string;
  /** Подсказка «плюса», когда ставить нечего. */
  nothingToAdd: string;
  /** Заголовок страницы, с которой сняли всё. */
  emptyTitle: string;
  /** Кнопка входа в настройку. */
  editLabel: string;
  /** Что делать на пустой странице. */
  rebuildHint: string;
}

export const HOME_SURFACE: LayoutSurface = {
  useStore: useDashboardLayoutStore,
  removeLabel: "Убрать с главной",
  nothingToAdd: "Ставить нечего: на главной уже всё, что есть",
  emptyTitle: "На главной ничего не осталось",
  editLabel: "Настроить главную",
  rebuildHint: "Верните нужные или соберите главную заново.",
};

export const OVERVIEW_SURFACE: LayoutSurface = {
  useStore: useOverviewLayoutStore,
  removeLabel: "Убрать из обзора",
  nothingToAdd: "Ставить нечего: в обзоре уже всё, что есть",
  emptyTitle: "В обзоре ничего не осталось",
  editLabel: "Настроить обзор",
  rebuildHint: "Верните нужные или соберите обзор заново.",
};

export const LayoutSurfaceContext = createContext<LayoutSurface>(HOME_SURFACE);

export function useLayoutSurface(): LayoutSurface {
  return useContext(LayoutSurfaceContext);
}
