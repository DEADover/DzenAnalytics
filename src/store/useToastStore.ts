import { create } from "zustand";
import { holdPush, releasePush } from "../lib/pushHold";

/**
 * Плашка-отклик внизу по центру: «Операция удалена · Отменить», итог
 * синхронизации, «Дзен-мани подключён».
 *
 * Одна на всё приложение и одна за раз: новое действие сменяет прежнюю
 * плашку, как в почте, — отменить можно только последнее, так человек всегда
 * видит, что именно он отменяет. Исключение — плашка с «Отменить»: простое
 * сообщение (итог синхронизации, пришедший по таймеру) её не сбивает, а ждёт
 * и показывается сразу после неё.
 */
export interface Toast {
  id: number;
  text: string;
  /** Вернуть всё как было. Есть — на плашке кнопка «Отменить». */
  undo?: () => Promise<void> | void;
  /** Итог: «ok» — галочка, «err» — предупреждение. Нет — без значка. */
  tone?: "ok" | "err";
  /** Сколько висит, мс. */
  duration: number;
}

export interface ToastOptions {
  undo?: Toast["undo"];
  tone?: Toast["tone"];
  duration?: number;
}

/** С «Отменить» плашка висит дольше: её надо успеть прочитать и решить. */
export const UNDO_MS = 6000;
const PLAIN_MS = 2500;
/** Итог синхронизации — как и прежде под кнопками шапки. */
const RESULT_MS = 5000;
/** Ошибку читают внимательнее, и в ней бывает подсказка, что делать. */
const ERROR_MS = 8000;

interface ToastState {
  toast: Toast | null;
  /** Простое сообщение, пришедшее, пока висела плашка с отменой. */
  queued: Toast | null;
  show: (text: string, opts?: ToastOptions) => void;
  dismiss: (id?: number) => void;
  /** Нажали «Отменить» (кнопкой или ⌘Z). */
  runUndo: () => Promise<void>;
}

let seq = 0;

function durationOf(opts?: ToastOptions): number {
  if (opts?.duration) return opts.duration;
  if (opts?.undo) return UNDO_MS;
  if (opts?.tone === "err") return ERROR_MS;
  if (opts?.tone === "ok") return RESULT_MS;
  return PLAIN_MS;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toast: null,
  queued: null,

  show: (text, opts) => {
    const next: Toast = { id: ++seq, text, undo: opts?.undo, tone: opts?.tone, duration: durationOf(opts) };
    // Простое сообщение не сбивает плашку с отменой — ждёт своей очереди.
    if (!next.undo && get().toast?.undo) {
      set({ queued: next });
      return;
    }
    // Пока можно отменить, автоматическая отправка ждёт — столько, сколько
    // плашка на экране, с паузой на наведении (см. lib/pushHold). Новая
    // плашка без отмены сменила прежнюю — прежнее действие стало
    // окончательным, ждать больше нечего.
    if (next.undo) holdPush();
    else releasePush();
    set({ toast: next });
  },

  dismiss: (id) => {
    const cur = get().toast;
    if (!cur || (id !== undefined && cur.id !== id)) return;
    if (cur.undo) releasePush();
    const queued = get().queued;
    set({ toast: queued, queued: null });
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
export function toast(text: string, opts?: ToastOptions): void {
  useToastStore.getState().show(text, opts);
}
