import { create } from "zustand";

/**
 * Открыто ли окно «Тема оформления». Окно одно на приложение (App.tsx), а
 * открывают его из разных мест: настройки, палитра команд.
 */
interface ThemeModalState {
  open: boolean;
  show: () => void;
  hide: () => void;
}

export const useThemeModalStore = create<ThemeModalState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));
