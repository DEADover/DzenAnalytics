import { create } from "zustand";
import * as db from "../lib/db";
import {
  DEFAULT_ASSUMPTIONS,
  NEUTRAL_LEVERS,
  type ScenarioEvent,
  type ScenarioLevers,
  type WhatIfAssumptions,
} from "../lib/whatif";

/**
 * Сценарии «Что-если» (#107): рычаги каждого сценария, общие допущения и
 * своя сумма капитала. Сохраняются и переносятся между устройствами — прикидку
 * можно продолжить завтра и на другом компьютере.
 *
 * Какие счета считать капиталом, здесь НЕ хранится: этот выбор общий с FIRE
 * (`useFireStore`), чтобы капитал везде означал одно и то же.
 */
export interface WhatIfScenario extends ScenarioLevers {
  id: string;
  name: string;
}

export interface WhatIfState {
  /** Хотя бы один сценарий есть всегда. */
  scenarios: WhatIfScenario[];
  activeId: string;
  /** Второй сценарий на графике и в таблице; `null` — только «как сейчас». */
  compareId: string | null;
  assumptions: WhatIfAssumptions;
  /**
   * Стартовый капитал, введённый руками. Нужен, когда счета не выбраны или
   * данных из Дзен-мани нет (режим CSV). `null` — своей суммы не вводили.
   */
  manualCapital: number | null;
}

export const FIRST_SCENARIO_ID = "main";

export const DEFAULT_WHATIF: WhatIfState = {
  scenarios: [{ id: FIRST_SCENARIO_ID, name: "Мой сценарий", ...NEUTRAL_LEVERS }],
  activeId: FIRST_SCENARIO_ID,
  compareId: null,
  assumptions: DEFAULT_ASSUMPTIONS,
  manualCapital: null,
};

const KEY = "whatIfScenario";
const MAX_SCENARIOS = 8;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;

function parseEvent(v: unknown): ScenarioEvent | null {
  if (!isObj(v)) return null;
  if (typeof v.id !== "string" || !isNum(v.amount) || v.amount <= 0) return null;
  if (typeof v.start !== "string" || !YM.test(v.start)) return null;
  return {
    id: v.id,
    title: typeof v.title === "string" ? v.title : "",
    kind: v.kind === "monthly" ? "monthly" : "once",
    sign: v.sign === "income" ? "income" : "expense",
    amount: v.amount,
    start: v.start,
    months: isNum(v.months) && v.months > 0 ? Math.round(v.months) : null,
  };
}

function parseLevers(o: Record<string, unknown>): ScenarioLevers {
  const categoryMul: Record<string, number> = {};
  if (isObj(o.categoryMul)) {
    for (const [k, m] of Object.entries(o.categoryMul)) if (isNum(m) && m >= 0) categoryMul[k] = m;
  }
  return {
    incomeMul: isNum(o.incomeMul) && o.incomeMul >= 0 ? o.incomeMul : 1,
    expenseMul: isNum(o.expenseMul) && o.expenseMul >= 0 ? o.expenseMul : 1,
    extraMonthlySave: isNum(o.extraMonthlySave) && o.extraMonthlySave >= 0 ? o.extraMonthlySave : 0,
    categoryMul,
    events: Array.isArray(o.events)
      ? o.events.map(parseEvent).filter((e): e is ScenarioEvent => e !== null)
      : [],
  };
}

function parseAssumptions(v: unknown): WhatIfAssumptions {
  const d = DEFAULT_ASSUMPTIONS;
  if (!isObj(v)) return d;
  const inRange = (x: unknown, lo: number, hi: number, def: number) =>
    isNum(x) && x >= lo && x <= hi ? x : def;
  return {
    returnPct: inRange(v.returnPct, -50, 100, d.returnPct),
    inflationPct: inRange(v.inflationPct, -50, 100, d.inflationPct),
    horizonYears: inRange(v.horizonYears, 0, 100, d.horizonYears),
    baseMonths: inRange(v.baseMonths, 1, 36, d.baseMonths),
    basis: v.basis === "median" ? "median" : "average",
    withdrawalPct: inRange(v.withdrawalPct, 1, 10, d.withdrawalPct),
    incomeGrowthPct: inRange(v.incomeGrowthPct, 0, 20, d.incomeGrowthPct),
  };
}

/**
 * Разобрать сохранённое состояние. Запись мог оставить другой клиент или
 * старая версия: неподходящее поле берём по умолчанию, а не роняем всё.
 * Понимает и первую версию — один сценарий плоским объектом.
 */
export function parseWhatIfState(v: unknown): WhatIfState | null {
  if (!isObj(v)) return null;
  const manualCapital = isNum(v.manualCapital) ? v.manualCapital : null;
  const assumptions = parseAssumptions(v.assumptions);

  const scenarios: WhatIfScenario[] = [];
  if (Array.isArray(v.scenarios)) {
    for (const s of v.scenarios) {
      if (!isObj(s) || typeof s.id !== "string") continue;
      if (scenarios.some((x) => x.id === s.id)) continue;
      const name = typeof s.name === "string" && s.name.trim() ? s.name.trim() : "Сценарий";
      scenarios.push({ id: s.id, name, ...parseLevers(s) });
    }
  } else if ("incomeMul" in v || "expenseMul" in v) {
    scenarios.push({ ...DEFAULT_WHATIF.scenarios[0], ...parseLevers(v) });
  }
  if (scenarios.length === 0) scenarios.push(DEFAULT_WHATIF.scenarios[0]);

  const ids = scenarios.map((s) => s.id);
  const activeId = typeof v.activeId === "string" && ids.includes(v.activeId) ? v.activeId : ids[0];
  const compareId =
    typeof v.compareId === "string" && ids.includes(v.compareId) && v.compareId !== activeId
      ? v.compareId
      : null;
  return { scenarios: scenarios.slice(0, MAX_SCENARIOS), activeId, compareId, assumptions, manualCapital };
}

/** Сдвинут ли хоть один рычаг — от этого зависит кнопка «Сбросить». */
export function isScenarioChanged(s: ScenarioLevers): boolean {
  return (
    s.incomeMul !== 1 ||
    s.expenseMul !== 1 ||
    s.extraMonthlySave !== 0 ||
    Object.values(s.categoryMul).some((m) => m !== 1) ||
    s.events.length > 0
  );
}

/** Имя нового сценария, которого ещё нет: «Сценарий 2», «Сценарий 3». */
export function nextScenarioName(names: readonly string[], stem = "Сценарий"): string {
  for (let i = 2; ; i++) {
    const name = `${stem} ${i}`;
    if (!names.includes(name)) return name;
  }
}

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

interface Store extends WhatIfState {
  loaded: boolean;
  hydrate: () => Promise<void>;
  /** Заменить всё — перенос между устройствами. */
  replace: (next: WhatIfState) => Promise<void>;
  /** Поменять рычаги открытого сценария. */
  updateActive: (patch: Partial<ScenarioLevers>) => Promise<void>;
  /**
   * Вернуть к «как сейчас» доход, расход и «сверх того» открытого сценария.
   * Категории и события не трогает: они в своих карточках, и у каждой
   * строки там своя кнопка удаления.
   */
  resetActive: () => Promise<void>;
  setActive: (id: string) => Promise<void>;
  setCompare: (id: string | null) => Promise<void>;
  /** Новый сценарий — пустой или копией открытого. Возвращает `false`, если места нет. */
  addScenario: (copy: boolean) => Promise<boolean>;
  renameScenario: (id: string, name: string) => Promise<void>;
  removeScenario: (id: string) => Promise<void>;
  updateAssumptions: (patch: Partial<WhatIfAssumptions>) => Promise<void>;
  setManualCapital: (v: number | null) => Promise<void>;
}

export function pickWhatIf(s: WhatIfState): WhatIfState {
  return {
    scenarios: s.scenarios,
    activeId: s.activeId,
    compareId: s.compareId,
    assumptions: s.assumptions,
    manualCapital: s.manualCapital,
  };
}

export const useWhatIfStore = create<Store>((set, get) => {
  /** Применить сразу (бегунок не должен ждать диска), сохранить следом. */
  const commit = async (patch: Partial<WhatIfState>) => {
    const next = { ...pickWhatIf(get()), ...patch };
    set(next);
    await db.saveJSON(KEY, next);
  };
  const mapActive = (fn: (s: WhatIfScenario) => WhatIfScenario) => {
    const { scenarios, activeId } = get();
    return scenarios.map((s) => (s.id === activeId ? fn(s) : s));
  };

  return {
    ...DEFAULT_WHATIF,
    loaded: false,

    hydrate: async () => {
      const stored = parseWhatIfState(await db.loadJSON<unknown>(KEY));
      set({ ...(stored ?? DEFAULT_WHATIF), loaded: true });
    },

    replace: (next) => commit(next),

    updateActive: (patch) => commit({ scenarios: mapActive((s) => ({ ...s, ...patch })) }),

    resetActive: () =>
      commit({
        scenarios: mapActive((s) => ({
          ...s,
          incomeMul: NEUTRAL_LEVERS.incomeMul,
          expenseMul: NEUTRAL_LEVERS.expenseMul,
          extraMonthlySave: NEUTRAL_LEVERS.extraMonthlySave,
        })),
      }),

    setActive: (id) => {
      const { scenarios, compareId } = get();
      if (!scenarios.some((s) => s.id === id)) return Promise.resolve();
      return commit({ activeId: id, compareId: compareId === id ? null : compareId });
    },

    setCompare: (id) => {
      const { scenarios, activeId } = get();
      const ok = id !== null && id !== activeId && scenarios.some((s) => s.id === id);
      return commit({ compareId: ok ? id : null });
    },

    addScenario: async (copy) => {
      const { scenarios, activeId } = get();
      if (scenarios.length >= MAX_SCENARIOS) return false;
      const names = scenarios.map((s) => s.name);
      const active = scenarios.find((s) => s.id === activeId)!;
      const scenario: WhatIfScenario = copy
        ? {
            ...active,
            id: newId(),
            name: names.includes(`${active.name} (копия)`)
              ? nextScenarioName(names, `${active.name} (копия)`)
              : `${active.name} (копия)`,
            events: active.events.map((e) => ({ ...e, id: newId() })),
          }
        : { id: newId(), name: nextScenarioName(names), ...NEUTRAL_LEVERS };
      // Открытый становится сравнением: новый сценарий почти всегда делают,
      // чтобы сравнить его с тем, что было.
      await commit({ scenarios: [...scenarios, scenario], activeId: scenario.id, compareId: activeId });
      return true;
    },

    renameScenario: (id, name) => {
      const clean = name.trim();
      if (!clean) return Promise.resolve();
      return commit({ scenarios: get().scenarios.map((s) => (s.id === id ? { ...s, name: clean } : s)) });
    },

    removeScenario: (id) => {
      const { scenarios, activeId, compareId } = get();
      if (scenarios.length <= 1) return Promise.resolve();
      const rest = scenarios.filter((s) => s.id !== id);
      const nextActive = activeId === id ? (compareId && compareId !== id ? compareId : rest[0].id) : activeId;
      const nextCompare = compareId === id || compareId === nextActive ? null : compareId;
      return commit({ scenarios: rest, activeId: nextActive, compareId: nextCompare });
    },

    updateAssumptions: (patch) => commit({ assumptions: { ...get().assumptions, ...patch } }),

    setManualCapital: (v) => commit({ manualCapital: v }),
  };
});

export { MAX_SCENARIOS, newId as newWhatIfId };
