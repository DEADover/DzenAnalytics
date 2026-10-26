import { create } from "zustand";

/**
 * Место в шапке раздела для его настроек (`SectionControls`).
 *
 * Шапка и ряд настроек — соседи, а не родитель с ребёнком: страница рисует
 * шапку, общий фильтр и уже потом настройки. Шапка отдаёт сюда свой узел,
 * настройки рисуются в него порталом — строка под фильтром, где они стояли,
 * пропадает вместе с пустым местом вокруг.
 */
export const useHeaderSlotStore = create<{ el: HTMLElement | null }>(() => ({ el: null }));

/** Шапка: отдать узел (или `null`, уходя со страницы). */
export function setHeaderSlot(el: HTMLElement | null): void {
  if (useHeaderSlotStore.getState().el !== el) useHeaderSlotStore.setState({ el });
}
