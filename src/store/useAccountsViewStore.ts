// Как настроена страница «Счета»: вкладка, вид графика, отборы и порядок
// списка.
//
// Всё это жило в `useState` самой страницы — и пропадало, стоило уйти на
// «Операции» и вернуться: React размонтирует страницу вместе с её состоянием.
// Человек при этом ничего не «переключал обратно», он просто сходил в другой
// раздел, а список снова показывал все типы, все банки и порядок по сумме.
//
// Настройки ПОКАЗА, а не данных: в IDB, рядом с темой и размером шрифта таблиц
// (`useDisplayStore`), а не в общем отборе (`useFiltersStore`) — тот про то,
// какие операции считать, и уезжает в сохранённые фильтры.

import { create } from "zustand";
import * as db from "../lib/db";

const KEY = "accountsView";

/** Разделы страницы: остатки и их история против оборотов за период. */
export type AccountsTab = "capital" | "flow";
/** Вид графика остатков: слоями по счетам или одной линией. */
export type AccountsChartView = "stacked" | "single";
/** Список счетов: таблицей или карточками. */
export type AccountsListView = "cards" | "table";
/**
 * Что сортируем. Ключи совпадают с колонками таблицы — по клику в её шапке,
 * как в остальных таблицах сервиса; «bank» колонки не имеет и задаётся из меню
 * сортировки (оно нужно карточкам, где шапки нет).
 */
export type AccountsSortBy =
  | "balance"
  | "alpha"
  | "bank"
  | "type"
  | "delta"
  | "income"
  | "expense"
  | "count";
export type AccountsSortDir = "asc" | "desc";
export type AccountsGroupBy = "none" | "type" | "bank";
/** Три состояния вместо двух галочек-антонимов: «в балансе» и «вне баланса»
 *  взаимоисключающие, и одновременно включёнными они дали бы пустой список. */
export type AccountsBalanceScope = "all" | "in" | "out";

/**
 * Множества хранятся массивами: `Set` в IndexedDB не кладётся, а обратно
 * страница собирает их сама. Пустой массив = «все» — то же соглашение, что у
 * `MultiSelect` и у общего отбора.
 */
export interface AccountsViewPrefs {
  tab: AccountsTab;
  chartView: AccountsChartView;
  /** Счета, выбранные для графика остатков. Пусто — автоматика (крупнейшие). */
  chartAccounts: string[];
  listView: AccountsListView;
  typeFilter: string[];
  bankFilter: string[];
  balanceScope: AccountsBalanceScope;
  onlySavings: boolean;
  hideArchived: boolean;
  sortBy: AccountsSortBy;
  sortDir: AccountsSortDir;
  groupBy: AccountsGroupBy;
}

export const ACCOUNTS_VIEW_DEFAULTS: AccountsViewPrefs = {
  tab: "capital",
  chartView: "stacked",
  chartAccounts: [],
  listView: "table",
  typeFilter: [],
  bankFilter: [],
  balanceScope: "all",
  onlySavings: false,
  hideArchived: false,
  sortBy: "balance",
  sortDir: "desc",
  groupBy: "none",
};

interface State extends AccountsViewPrefs {
  loaded: boolean;
  hydrate: () => Promise<void>;
  /** Меняем сколько угодно полей разом — одна запись в IDB на действие. */
  patch: (p: Partial<AccountsViewPrefs>) => Promise<void>;
}

const SORT_KEYS = new Set<string>([
  "balance",
  "alpha",
  "bank",
  "type",
  "delta",
  "income",
  "expense",
  "count",
]);

/**
 * Прочитанное из хранилища приводим к своим типам.
 *
 * Записи переживают обновления сервиса: у кого-то в IDB лежит порядок по
 * колонке, которой уже нет, или вид списка из будущей версии. Мусор молча
 * заменяем значением по умолчанию — страница не должна падать из-за старой
 * настройки показа.
 */
function normalize(raw: Partial<AccountsViewPrefs> | null): AccountsViewPrefs {
  const d = ACCOUNTS_VIEW_DEFAULTS;
  if (!raw) return { ...d };
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(v as T) ? (v as T) : fallback;

  const listView = oneOf(raw.listView, ["cards", "table"] as const, d.listView);
  let sortBy = SORT_KEYS.has(raw.sortBy as string)
    ? (raw.sortBy as AccountsSortBy)
    : d.sortBy;
  // «По банку» выбирают только карточки: в таблице такой колонки нет, её шапка
  // не подсветится, и порядок выглядел бы случайным.
  if (listView === "table" && sortBy === "bank") sortBy = d.sortBy;

  return {
    tab: oneOf(raw.tab, ["capital", "flow"] as const, d.tab),
    chartView: oneOf(raw.chartView, ["stacked", "single"] as const, d.chartView),
    chartAccounts: strings(raw.chartAccounts),
    listView,
    typeFilter: strings(raw.typeFilter),
    bankFilter: strings(raw.bankFilter),
    balanceScope: oneOf(raw.balanceScope, ["all", "in", "out"] as const, d.balanceScope),
    onlySavings: raw.onlySavings === true,
    hideArchived: raw.hideArchived === true,
    sortBy,
    sortDir: oneOf(raw.sortDir, ["asc", "desc"] as const, d.sortDir),
    groupBy: oneOf(raw.groupBy, ["none", "type", "bank"] as const, d.groupBy),
  };
}

/** Всё, что кладём в IDB, — одним местом, чтобы `patch` не забывал поля. */
function persisted(s: AccountsViewPrefs): AccountsViewPrefs {
  return {
    tab: s.tab,
    chartView: s.chartView,
    chartAccounts: s.chartAccounts,
    listView: s.listView,
    typeFilter: s.typeFilter,
    bankFilter: s.bankFilter,
    balanceScope: s.balanceScope,
    onlySavings: s.onlySavings,
    hideArchived: s.hideArchived,
    sortBy: s.sortBy,
    sortDir: s.sortDir,
    groupBy: s.groupBy,
  };
}

export const useAccountsViewStore = create<State>((set, get) => ({
  ...ACCOUNTS_VIEW_DEFAULTS,
  loaded: false,

  hydrate: async () => {
    const raw = await db.loadJSON<Partial<AccountsViewPrefs>>(KEY);
    set({ ...normalize(raw), loaded: true });
  },

  patch: async (p) => {
    set(p);
    await db.saveJSON(KEY, persisted({ ...get(), ...p }));
  },
}));

export const __test = { normalize, persisted };
