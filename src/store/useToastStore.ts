import { create } from "zustand";
import { holdPush, releasePush } from "../lib/pushHold";

/**
 * Плашка-отклик на действие: «Операция удалена · Отменить».
 *
 * Одна на всё приложение и одна за раз: новое действие сменяет прежнюю
 * плашку, как в почте. Отменить можно только последнее — так человек всегда
 * видит, что именно он отменяет.
 */
export interface Toast {
  id: number;
  text: string;
  /** Вернуть всё как было. Есть — на плашке кнопка «Отменить». */
  undo?: () => Promise<void> | void;
  /** Сколько висит, мс. */
  duration: number;
}

/** С «Отменить» плашка висит дольше: её надо успеть прочитать и решить. */
export const UNDO_MS = 6000;
const PLAIN_MS = 2500;

interface ToastState {
  toast: Toast | null;
  show: (text: string, opts?: { undo?: Toast["undo"]; duration?: number }) => void;
  dismiss: (id?: number) => void;
  /** Нажали «Отменить» (кнопкой или ⌘Z). */
  runUndo: () => Promise<void>;
}

let seq = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  toast: null,

  show: (text, opts) => {
    const duration = opts?.duration ?? (opts?.undo ? UNDO_MS : PLAIN_MS);
    // Пока можно отменить, автоматическая отправка ждёт (см. lib/pushHold).
    if (opts?.undo) holdPush(duration + 500);
    set({ toast: { id: ++seq, text, undo: opts?.undo, duration } });
  },

  dismiss: (id) => {
    const cur = get().toast;
    if (!cur || (id !== undefined && cur.id !== id)) return;
    if (cur.undo) releasePush();
    set({ toast: null });
  },

  runUndo: async () => {
    const cur = get().toast;
    if (!cur?.undo) return;
    // Плашку убираем сразу: второй щелчок не должен отменить дважды.
    set({ toast: null });
    try {
      await cur.undo();
      get().show("Отменено");
    } finally {
      releasePush();
    }
  },
}));

/** Короткий вызов из обработчиков. */
export function toast(text: string, opts?: { undo?: Toast["undo"]; duration?: number }): void {
  useToastStore.getState().show(text, opts);
}
