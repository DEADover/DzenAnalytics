/**
 * Память фильтра между сессиями (issue #79).
 *
 * Текущее состояние фильтра жило только до перезагрузки вкладки: сторонний
 * стор без диска, и в бэкап класть было нечего. Здесь появляется снимок,
 * который переживает перезагрузку и едет вместе с остальными настройками.
 *
 * ПЕРИОД в снимок НЕ входит — и это решение, а не пропуск. Приложение
 * специально сбрасывает период к текущему месяцу при каждом запуске
 * (`resetToCurrentPeriod` в App), и правильно делает: открыть финансовый
 * дашборд и увидеть позапрошлый август — худшее, что он может сделать. Ровно
 * по этой же причине сохранённые виды помнят период отдельным флажком
 * `includePeriod`, а не всегда.
 *
 * По умолчанию память ВЫКЛЮЧЕНА: привычка «перезагрузил — фильтр чист» у людей
 * уже есть, и менять её молча нельзя.
 */

import { create } from "zustand";
import * as db from "../lib/db";
import { useFiltersStore } from "./useFiltersStore";

const KEY = "filterMemory";

/** Снимок фильтра — всё, что человек выбрал, кроме периода. */
export interface FilterSnapshot {
  accounts: string[];
  categories: string[];
  currencies: string[];
  search: string;
  excludeTransfers: boolean;
  minAmount: number | null;
  maxAmount: number | null;
  types: string[];
  onlyUncategorized: boolean;
  hideZero: boolean;
  onlyWithComment: boolean;
  onlyNew: boolean;
  excludeOffBalance: boolean;
}

/** Что лежит в базе под `filterMemory`. */
export interface FilterMemory {
  enabled: boolean;
  snapshot: FilterSnapshot | null;
}

/** Поля фильтра, которые снимаем. Структурно, а не через `FiltersState`:
 *  так функцию можно позвать из теста, не поднимая весь стор. */
export interface FilterValues {
  accounts: Set<string>;
  categories: Set<string>;
  currencies: Set<string>;
  search: string;
  excludeTransfers: boolean;
  minAmount: number | null;
  maxAmount: number | null;
  types: Set<string>;
  onlyUncategorized: boolean;
  hideZero: boolean;
  onlyWithComment: boolean;
  onlyNew: boolean;
  excludeOffBalance: boolean;
}

/** Снять фильтр в вид, который переживёт JSON. Множества — массивами. */
export function snapshotFilters(s: FilterValues): FilterSnapshot {
  return {
    accounts: [...s.accounts],
    categories: [...s.categories],
    currencies: [...s.currencies],
    search: s.search,
    excludeTransfers: s.excludeTransfers,
    minAmount: s.minAmount,
    maxAmount: s.maxAmount,
    types: [...s.types],
    onlyUncategorized: s.onlyUncategorized,
    hideZero: s.hideZero,
    onlyWithComment: s.onlyWithComment,
    onlyNew: s.onlyNew,
    excludeOffBalance: s.excludeOffBalance,
  };
}

/** Пустой фильтр — ничего не выбрано. Такой снимок хранить незачем. */
export function isEmptySnapshot(s: FilterSnapshot): boolean {
  return (
    s.accounts.length === 0 &&
    s.categories.length === 0 &&
    s.currencies.length === 0 &&
    s.search.trim() === "" &&
    !s.excludeTransfers &&
    s.minAmount == null &&
    s.maxAmount == null &&
    s.types.length === 0 &&
    !s.onlyUncategorized &&
    !s.hideZero &&
    !s.onlyWithComment &&
    !s.onlyNew &&
    !s.excludeOffBalance
  );
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const bool = (v: unknown): boolean => v === true;
const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * Разобрать снимок из базы или бэкапа обратно в значения фильтра.
 *
 * Читаем ЧУЖОЙ json — файл бэкапа человек мог править руками, да и сам формат
 * со временем меняется. Поэтому каждое поле приводим к своему типу, а не
 * доверяем ему на слово: строкой в `minAmount` можно уронить сравнение,
 * а мусором в множестве — спрятать все операции. `null` — снимка нет.
 */
export function restoreFilters(raw: unknown): FilterValues | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  return {
    accounts: new Set(strings(s.accounts)),
    categories: new Set(strings(s.categories)),
    currencies: new Set(strings(s.currencies)),
    search: typeof s.search === "string" ? s.search : "",
    excludeTransfers: bool(s.excludeTransfers),
    minAmount: numOrNull(s.minAmount),
    maxAmount: numOrNull(s.maxAmount),
    types: new Set(strings(s.types)),
    onlyUncategorized: bool(s.onlyUncategorized),
    hideZero: bool(s.hideZero),
    onlyWithComment: bool(s.onlyWithComment),
    onlyNew: bool(s.onlyNew),
    excludeOffBalance: bool(s.excludeOffBalance),
  };
}

/** Пауза перед записью: фильтр меняется на каждую букву в поиске. */
const SAVE_DELAY = 500;

interface FilterMemoryState {
  enabled: boolean;
  loaded: boolean;
  hydrate: () => Promise<void>;
  setEnabled: (on: boolean) => Promise<void>;
  /** Следить за фильтром и складывать его на диск. Возвращает отписку. */
  watch: () => () => void;
}

export const useFilterMemoryStore = create<FilterMemoryState>((set, get) => ({
  enabled: false,
  loaded: false,

  hydrate: async () => {
    const data = await db.loadJSON<FilterMemory>(KEY);
    const enabled = data?.enabled === true;
    set({ enabled, loaded: true });
    if (!enabled) return;
    const values = restoreFilters(data?.snapshot);
    // Период не трогаем: его согласует `resetToCurrentPeriod` в App.
    if (values) useFiltersStore.setState(values);
  },

  setEnabled: async (on) => {
    // Выключили — снимок стираем сразу, чтобы он не уехал в следующий бэкап
    // и не всплыл через полгода при восстановлении.
    const snapshot = on ? snapshotFilters(useFiltersStore.getState()) : null;
    await db.saveJSON(KEY, {
      enabled: on,
      snapshot: snapshot && !isEmptySnapshot(snapshot) ? snapshot : null,
    } satisfies FilterMemory);
    set({ enabled: on });
  },

  watch: () => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useFiltersStore.subscribe((state) => {
      if (!get().enabled) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const snapshot = snapshotFilters(state);
        void db.saveJSON(KEY, {
          enabled: true,
          snapshot: isEmptySnapshot(snapshot) ? null : snapshot,
        } satisfies FilterMemory);
      }, SAVE_DELAY);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  },
}));
