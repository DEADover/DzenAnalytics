import { create } from "zustand";
import type { ThemeKind } from "../lib/themeSchemes";

/**
 * Открыто ли окно «Тема оформления». Окно одно на приложение (App.tsx), а
 * открывают его из разных мест: настройки, палитра команд.
 *
 * `editing` — окно показывает редактор своей темы этого вида вместо списка.
 */
interface ThemeModalState {
  open: boolean;
  editing: ThemeKind | null;
  show: () => void;
  /** Открыть сразу редактор своей темы (из палитры, из плитки «Своя»). */
  edit: (kind: ThemeKind) => void;
  /** Из редактора — назад к списку тем. */
  back: () => void;
  hide: () => void;
}

export const useThemeModalStore = create<ThemeModalState>((set) => ({
  open: false,
  editing: null,
  show: () => set({ open: true, editing: null }),
  edit: (kind) => set({ open: true, editing: kind }),
  back: () => set({ editing: null }),
  hide: () => set({ open: false, editing: null }),
}));
