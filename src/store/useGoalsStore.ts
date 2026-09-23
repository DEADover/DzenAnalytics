import { create } from "zustand";
import * as db from "../lib/db";

export interface Goal {
  id: string;
  name: string;
  target: number;
  /** Manually entered progress. Ignored while the goal is bound to accounts —
   *  then their balances are the live progress (issues #45, #103). */
  current: number;
  deadline: string | null;
  /** Optional Zenmoney account this goal tracks: progress = its balance, so it
   *  updates by itself on every sync. `null` / absent = manual amount. */
  accountTitle?: string | null;
  /**
   * Счета, на которых копится цель (#103): прогресс — сумма их балансов в
   * базовой валюте по курсу ЦБ на сегодня. Пустой список или отсутствие поля —
   * смотрим на `accountTitle` (цели прежних версий). Первый счёт дублируется в
   * `accountTitle`, чтобы устройство на старой версии видело хоть его.
   */
  accountTitles?: string[] | null;
  /** Optional planned monthly contribution to THIS goal. When set (> 0) it
   *  drives a per-goal forecast independent of the household savings pace, so
   *  the user can model «если откладывать N в месяц». `null` / absent = only
   *  the household-pace forecast is shown. */
  monthlyContribution?: number | null;
  createdAt: string;
}

interface GoalsState {
  goals: Goal[];
  loaded: boolean;
  hydrate: () => Promise<void>;
  add: (g: Omit<Goal, "id" | "createdAt">) => Promise<void>;
  update: (id: string, patch: Partial<Goal>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Заменить список целиком — перенос настроек между устройствами. */
  replaceAll: (items: readonly Goal[]) => Promise<void>;
}

export const useGoalsStore = create<GoalsState>((set, get) => ({
  goals: [],
  loaded: false,
  hydrate: async () => {
    const data = await db.loadJSON<Goal[]>("goals");
    set({ goals: data || [], loaded: true });
  },
  add: async (g) => {
    const next: Goal = {
      ...g,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
    };
    const list = [...get().goals, next];
    await db.saveJSON("goals", list);
    set({ goals: list });
  },
  update: async (id, patch) => {
    const list = get().goals.map((g) => (g.id === id ? { ...g, ...patch } : g));
    await db.saveJSON("goals", list);
    set({ goals: list });
  },
  remove: async (id) => {
    const list = get().goals.filter((g) => g.id !== id);
    await db.saveJSON("goals", list);
    set({ goals: list });
  },
  replaceAll: async (items) => {
    const list = items.filter((g) => g && typeof g.id === "string").map((g) => ({ ...g }));
    await db.saveJSON("goals", list);
    set({ goals: list });
  },
}));
