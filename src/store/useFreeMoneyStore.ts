import { create } from "zustand";
import * as db from "../lib/db";
import type { DailyMethod } from "../lib/freeMoney";

/**
 * Настройки виджета «Свободные деньги» (issue #96).
 *
 * Два поля: как делить остаток по дням и сколько денег не трогать вовсе.
 * Живут одним блоком, а не двумя ключами, — их всегда правят вместе и всегда
 * читают вместе, а лишний ключ в бэкапе пришлось бы объяснять отдельно.
 *
 * ХРАНИМ ОБЪЕКТОМ, А НЕ ГОЛЫМИ ЗНАЧЕНИЯМИ. `db.loadJSON` возвращает `null` на
 * любом ложном значении: сохранённый `0` читается как «ничего не сохранено».
 * Резерв в ноль — совершенно нормальная настройка, и внутри объекта он
 * переживает чтение без всяких ухищрений.
 */
interface FreeMoneySettings {
  method: DailyMethod;
  /** Неснижаемый остаток в базовой валюте — вычитается из свободных сразу. */
  reserve: number;
}

const KEY = "freeMoneySettings";

const DEFAULTS: FreeMoneySettings = {
  // По умолчанию накопительный: он прощает неровные дни, а именно неровными
  // траты и бывают. Ежедневный обнуляет вчерашнюю экономию и потому строже.
  method: "cumulative",
  reserve: 0,
};

interface State extends FreeMoneySettings {
  loaded: boolean;
  hydrate: () => Promise<void>;
  setMethod: (method: DailyMethod) => Promise<void>;
  setReserve: (reserve: number) => Promise<void>;
}

export const useFreeMoneyStore = create<State>((set, get) => {
  const save = async (next: FreeMoneySettings) => {
    set(next);
    await db.saveJSON(KEY, next);
  };
  const current = (): FreeMoneySettings => ({
    method: get().method,
    reserve: get().reserve,
  });

  return {
    ...DEFAULTS,
    loaded: false,
    hydrate: async () => {
      const data = await db.loadJSON<Partial<FreeMoneySettings>>(KEY);
      set({
        method: data?.method === "daily" ? "daily" : DEFAULTS.method,
        reserve: normalizeReserve(data?.reserve),
        loaded: true,
      });
    },
    setMethod: (method) => save({ ...current(), method }),
    setReserve: (reserve) =>
      save({ ...current(), reserve: normalizeReserve(reserve) }),
  };
});

/** Резерв — это сумма, а не выражение: отрицательный и мусор считаем нулём. */
function normalizeReserve(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}
