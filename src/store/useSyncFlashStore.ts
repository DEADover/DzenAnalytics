import { create } from "zustand";

export interface SyncFlash {
  tone: "ok" | "err";
  text: string;
}

/**
 * Итог синхронизации или отправки — плашка под кнопками обмена с облаком в
 * шапке.
 *
 * Отдельным стором, а не состоянием кнопок: на телефоне полная синхронизация
 * запускается из меню, которое тут же закрывается, а итог всё равно
 * показывает шапка.
 */
interface SyncFlashState {
  flash: SyncFlash | null;
  /** Плашка доигрывает исчезновение и вот-вот пропадёт. */
  closing: boolean;
  show: (flash: SyncFlash) => void;
  startClosing: () => void;
  clear: () => void;
}

export const useSyncFlashStore = create<SyncFlashState>((set) => ({
  flash: null,
  closing: false,
  show: (flash) => set({ flash, closing: false }),
  startClosing: () => set({ closing: true }),
  clear: () => set({ flash: null, closing: false }),
}));
