// Обучение: какая глава идёт, на каком шаге, что пройдено.
//
// Прогресс — на устройство, а не на аккаунт панели: учится человек, а не
// аккаунт, и переключение на демо или семейный аккаунт не должно заново
// показывать знакомство. Лежит в localStorage; недоступен — обучение всё
// равно работает, просто не запоминается.

import { create } from "zustand";
import { TOUR_CHAPTERS, tourChapter } from "../lib/tour";

const KEY = "dzenanalytics:tour";

interface Saved {
  done: string[];
  /** Знакомство уже предлагали — сами больше не запускаем. */
  welcomed: boolean;
}

function load(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Saved> | null;
    return {
      done: Array.isArray(raw?.done) ? raw!.done.filter((x): x is string => typeof x === "string") : [],
      welcomed: raw?.welcomed === true,
    };
  } catch {
    return { done: [], welcomed: false };
  }
}

function save(s: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // без localStorage обучение просто не запоминается
  }
}

interface State extends Saved {
  /** Идущая глава; `null` — обучения на экране нет. */
  chapter: string | null;
  step: number;
  hubOpen: boolean;
  start: (chapterId: string) => void;
  next: () => void;
  back: () => void;
  /** Закрыть главу. `completed` — дошли до конца, а не прервали. */
  stop: (completed?: boolean) => void;
  openHub: () => void;
  closeHub: () => void;
  markWelcomed: () => void;
}

export const useTourStore = create<State>((set, get) => {
  const persist = () => save({ done: get().done, welcomed: get().welcomed });
  return {
    ...load(),
    chapter: null,
    step: 0,
    hubOpen: false,
    start: (chapterId) => {
      if (!tourChapter(chapterId)) return;
      set({ chapter: chapterId, step: 0, hubOpen: false, welcomed: true });
      persist();
    },
    next: () => {
      const { chapter, step } = get();
      const c = chapter ? tourChapter(chapter) : undefined;
      if (!c) return;
      if (step + 1 < c.steps.length) set({ step: step + 1 });
      else get().stop(true);
    },
    back: () => set((s) => ({ step: Math.max(0, s.step - 1) })),
    stop: (completed = false) => {
      const { chapter, done } = get();
      set({
        chapter: null,
        step: 0,
        done: completed && chapter && !done.includes(chapter) ? [...done, chapter] : done,
      });
      persist();
    },
    openHub: () => set({ hubOpen: true }),
    closeHub: () => set({ hubOpen: false }),
    markWelcomed: () => {
      set({ welcomed: true });
      persist();
    },
  };
});

/** Сколько глав пройдено из всех — для центра обучения. */
export function tourProgress(done: string[]): { done: number; total: number } {
  return { done: TOUR_CHAPTERS.filter((c) => done.includes(c.id)).length, total: TOUR_CHAPTERS.length };
}
