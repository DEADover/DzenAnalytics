import { create } from "zustand";

/**
 * Панель общих фильтров, выезжающая из-под шапки.
 *
 * Раньше фильтры стояли первым блоком каждой страницы и занимали пол-экрана:
 * переходишь в раздел — видишь фильтр, а под ним краешек графика; хочешь
 * сменить месяц у графика внизу — листаешь наверх и обратно. Теперь панель
 * вызывается кнопкой в шапке с любого места страницы, ложится поверх
 * содержимого и прячется той же кнопкой.
 *
 * Сама панель — по-прежнему `GlobalFilters`, который страница рисует со своими
 * настройками (свой период, погашенные даты и т. п.). Он только уходит порталом
 * в `dockEl` — место под шапкой, которое держит `FiltersDock`.
 */
interface State {
  open: boolean;
  /** Место под шапкой, куда страница отдаёт свою панель. */
  dockEl: HTMLElement | null;
  /** Сколько панелей сейчас смонтировано: 0 — на странице фильтров нет. */
  clients: number;
  /** Задан ли хоть один фильтр — точка на кнопке в шапке. */
  active: boolean;
  setDockEl: (el: HTMLElement | null) => void;
  toggle: () => void;
  close: () => void;
  register: () => () => void;
  setActive: (active: boolean) => void;
}

export const useFiltersDockStore = create<State>((set, get) => ({
  open: false,
  dockEl: null,
  clients: 0,
  active: false,
  setDockEl: (dockEl) => {
    if (get().dockEl !== dockEl) set({ dockEl });
  },
  toggle: () => {
    if (get().clients === 0) return;
    set({ open: !get().open });
  },
  close: () => {
    if (get().open) set({ open: false });
  },
  register: () => {
    set({ clients: get().clients + 1 });
    return () => {
      const clients = Math.max(0, get().clients - 1);
      // Ушли со страницы с фильтрами — панели нечего показывать.
      set(clients === 0 ? { clients, open: false, active: false } : { clients });
    };
  },
  setActive: (active) => {
    if (get().active !== active) set({ active });
  },
}));
