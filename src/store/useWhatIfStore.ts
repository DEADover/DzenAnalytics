import { create } from "zustand";
import * as db from "../lib/db";

/**
 * Сценарий «Что-если» — положения бегунков и своя сумма капитала (#107).
 *
 * Раньше жил только в памяти вкладки и пропадал при перезагрузке, так что
 * прикидку нельзя было ни продолжить завтра, ни открыть на другом компьютере.
 * Теперь сохраняется и переносится между устройствами.
 *
 * Какие счета считать капиталом, здесь НЕ хранится: этот выбор общий с FIRE
 * (`useFireStore`), чтобы капитал везде означал одно и то же.
 */
export interface WhatIfScenario {
  /** Множитель дохода: 1 — без изменений, 1.2 — +20%. */
  incomeMul: number;
  /** Множитель расхода: 0.9 — −10%. */
  expenseMul: number;
  /** Сколько откладывать сверх нынешнего «доход − расход». */
  extraMonthlySave: number;
  /** Множители по категориям — по названию, как везде в сервисе. */
  categoryMul: Record<string, number>;
  /**
   * Стартовый капитал, введённый руками. Нужен, когда счета не выбраны или
   * данных из Дзен-мани нет (режим CSV). `null` — своей суммы не вводили.
   */
  manualCapital: number | null;
}

export const DEFAULT_WHATIF: WhatIfScenario = {
  incomeMul: 1,
  expenseMul: 1,
  extraMonthlySave: 0,
  categoryMul: {},
  manualCapital: null,
};

const KEY = "whatIfScenario";

interface State extends WhatIfScenario {
  loaded: boolean;
  hydrate: () => Promise<void>;
  update: (patch: Partial<WhatIfScenario>) => Promise<void>;
  /** Вернуть бегунки и свою сумму к исходным. */
  reset: () => Promise<void>;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Разобрать сохранённый сценарий. Запись мог оставить другой клиент или старая
 * версия: неподходящее поле берём по умолчанию, а не роняем весь сценарий.
 */
export function parseWhatIfScenario(v: unknown): WhatIfScenario | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const categoryMul: Record<string, number> = {};
  if (o.categoryMul && typeof o.categoryMul === "object" && !Array.isArray(o.categoryMul)) {
    for (const [k, m] of Object.entries(o.categoryMul)) if (isNum(m) && m >= 0) categoryMul[k] = m;
  }
  return {
    incomeMul: isNum(o.incomeMul) && o.incomeMul > 0 ? o.incomeMul : DEFAULT_WHATIF.incomeMul,
    expenseMul: isNum(o.expenseMul) && o.expenseMul > 0 ? o.expenseMul : DEFAULT_WHATIF.expenseMul,
    extraMonthlySave:
      isNum(o.extraMonthlySave) && o.extraMonthlySave >= 0
        ? o.extraMonthlySave
        : DEFAULT_WHATIF.extraMonthlySave,
    categoryMul,
    manualCapital: isNum(o.manualCapital) ? o.manualCapital : null,
  };
}

/** Сдвинут ли хоть один бегунок — от этого зависит кнопка «Сбросить». */
export function isScenarioChanged(s: WhatIfScenario): boolean {
  return (
    s.incomeMul !== 1 ||
    s.expenseMul !== 1 ||
    s.extraMonthlySave !== 0 ||
    Object.values(s.categoryMul).some((m) => m !== 1)
  );
}

export const useWhatIfStore = create<State>((set, get) => ({
  ...DEFAULT_WHATIF,
  loaded: false,

  hydrate: async () => {
    const stored = parseWhatIfScenario(await db.loadJSON<unknown>(KEY));
    set({ ...(stored ?? DEFAULT_WHATIF), loaded: true });
  },

  update: async (patch) => {
    const next = { ...pick(get()), ...patch };
    set(next);
    await db.saveJSON(KEY, next);
  },

  reset: async () => {
    set(DEFAULT_WHATIF);
    await db.saveJSON(KEY, DEFAULT_WHATIF);
  },
}));

/** Только сохраняемые поля — `loaded` и методы на диск не едут. */
export function pick(s: WhatIfScenario): WhatIfScenario {
  return {
    incomeMul: s.incomeMul,
    expenseMul: s.expenseMul,
    extraMonthlySave: s.extraMonthlySave,
    categoryMul: s.categoryMul,
    manualCapital: s.manualCapital,
  };
}
