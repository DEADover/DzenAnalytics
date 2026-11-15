import { create } from "zustand";
import * as db from "../lib/db";
import { DEFAULT_BENCHMARKS, parseBenchmarks, type BenchmarkSettings } from "../lib/benchmarks";

/**
 * Настройки «Ориентиров» в «Финансовом здоровье» (#134): какие показывать,
 * какие категории и счета к ним относятся, пороги.
 */
interface State extends BenchmarkSettings {
  loaded: boolean;
  hydrate: () => Promise<void>;
  update: (patch: Partial<BenchmarkSettings>) => Promise<void>;
}

export const BENCHMARKS_KEY = "healthBenchmarks";

/** Только сохраняемые поля — `loaded` и методы на диск не едут. */
export function pickBenchmarks(s: BenchmarkSettings): BenchmarkSettings {
  return parseBenchmarks(s);
}

export const useBenchmarksStore = create<State>((set, get) => ({
  ...DEFAULT_BENCHMARKS,
  loaded: false,

  hydrate: async () => {
    set({ ...parseBenchmarks(await db.loadJSON(BENCHMARKS_KEY)), loaded: true });
  },

  update: async (patch) => {
    const next = parseBenchmarks({ ...pickBenchmarks(get()), ...patch });
    await db.saveJSON(BENCHMARKS_KEY, next);
    set(next);
  },
}));
