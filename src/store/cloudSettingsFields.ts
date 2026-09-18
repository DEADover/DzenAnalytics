/**
 * Какие настройки переносятся между устройствами через Дзен-мани.
 *
 * Только то, чего нет в самом Дзен-мани. Не переносятся: бюджеты и планы (они
 * в Дзен-мани), цвета категорий, курсы, базовая валюта и первый день месяца
 * (берутся из Дзен-мани), очереди неотправленных правок, кэши и настройки
 * подключения этого устройства (режим отправки, автосинхронизация, бэкапы).
 * Правила переносятся отдельным документом — см. `useCloudSettingsStore`.
 *
 * Размер текста таблиц, место панели фильтров и режим темы — общие для всех
 * устройств (решение 16.09.2026).
 *
 * У каждого поля: как прочитать значение, как применить пришедшее (с проверкой —
 * запись мог оставить другой клиент или старая версия) и на какое хранилище
 * подписаться, чтобы заметить правку.
 */

import type { StoreApi, UseBoundStore } from "zustand";
import { useTagModeStore } from "./useTagModeStore";
import { useOffBalanceStore } from "./useOffBalanceStore";
import { useFreeMoneyStore } from "./useFreeMoneyStore";
import { useDisplayStore } from "./useDisplayStore";
import { useFilterMemoryStore } from "./useFilterMemoryStore";
import { useMembersStore } from "./useMembersStore";
import { useThemeStore } from "./useThemeStore";
import { useDashboardLayoutStore } from "./useDashboardLayoutStore";
import { useHeaderNavStore } from "./useHeaderNavStore";
import { useBudgetSettingsStore } from "./useBudgetSettingsStore";
import { useReportPeriodStore } from "./useReportPeriodStore";
import { useFireStore } from "./useFireStore";
import { useSlicesStore } from "./useSlicesStore";
import { isDarkSchemeId, isLightSchemeId } from "../lib/themeSchemes";

export interface SyncedField {
  key: string;
  /** Хранилище уже прочитало своё с диска — до этого значение не настоящее. */
  ready: () => boolean;
  read: () => unknown;
  /** Применить пришедшее; неподходящее значение молча пропускается. */
  write: (value: unknown) => Promise<void> | void;
  subscribe: (listener: () => void) => () => void;
}

type AnyStore<S> = UseBoundStore<StoreApi<S>>;

function field<S>(
  store: AnyStore<S>,
  key: string,
  read: (s: S) => unknown,
  write: (value: unknown, s: S) => Promise<void> | void,
  ready: (s: S) => boolean = (s) => (s as { loaded?: boolean }).loaded !== false
): SyncedField {
  return {
    key,
    ready: () => ready(store.getState()),
    read: () => read(store.getState()),
    write: (value) => write(value, store.getState()),
    subscribe: (listener) => store.subscribe(listener),
  };
}

const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");
const isCount = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;

export const SYNCED_FIELDS: readonly SyncedField[] = [
  // ── Расчёты ──
  field(useTagModeStore, "tagMode", (s) => s.mode, (v, s) =>
    v === "hashtags" || v === "categories" ? s.setMode(v) : undefined
  ),
  field(useOffBalanceStore, "includeOffBalance", (s) => s.includeOffBalance, (v, s) =>
    isBool(v) ? s.setIncludeOffBalance(v) : undefined
  ),
  field(useFreeMoneyStore, "freeMoney.method", (s) => s.method, (v, s) =>
    v === "cumulative" || v === "daily" ? s.setMethod(v) : undefined
  ),
  field(useFreeMoneyStore, "freeMoney.reserve", (s) => s.reserve, (v, s) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? s.setReserve(v) : undefined
  ),
  /**
   * Свой первый день отчётного месяца. `null` — своего нет, идём за днём из
   * настроек Дзен-мани; день в самом Дзен-мани общий и переноса не требует.
   */
  field(
    useReportPeriodStore,
    "reportPeriod.ownDay",
    (s) => (s.ownSet ? s.ownDay : null),
    (v, s) => {
      if (v === null) return s.ownSet ? s.followZenDay() : undefined;
      return typeof v === "number" && Number.isFinite(v) ? s.setMonthStartDay(v) : undefined;
    }
  ),
  // Счета вне капитала FIRE — по названию, как везде в фильтрах сервиса.
  field(useFireStore, "fire.excluded", (s) => s.excluded, (v, s) =>
    isStrings(v) ? s.replaceExcluded(v) : undefined
  ),

  // ── Бюджет ──
  // Периметр счетов, переводы через его границу, вид раздела и прогноз.
  field(useBudgetSettingsStore, "budget.accounts", (s) => s.accounts, (v, s) =>
    isStrings(v) ? s.update({ accounts: v }) : undefined
  ),
  field(useBudgetSettingsStore, "budget.perimeterTransfers", (s) => s.perimeterTransfers, (v, s) =>
    isBool(v) ? s.update({ perimeterTransfers: v }) : undefined
  ),
  field(useBudgetSettingsStore, "budget.defaultView", (s) => s.defaultView, (v, s) =>
    v === "month" || v === "year" || v === "dashboard" ? s.update({ defaultView: v }) : undefined
  ),
  field(useBudgetSettingsStore, "budget.rowOrder", (s) => s.rowOrder, (v, s) =>
    v === "alpha" || v === "amount" ? s.update({ rowOrder: v }) : undefined
  ),
  field(useBudgetSettingsStore, "budget.hideEmptyRows", (s) => s.hideEmptyRows, (v, s) =>
    isBool(v) ? s.update({ hideEmptyRows: v }) : undefined
  ),
  field(useBudgetSettingsStore, "budget.forecastMonths", (s) => s.forecastMonths, (v, s) =>
    isCount(v) ? s.update({ forecastMonths: v }) : undefined
  ),
  field(useBudgetSettingsStore, "budget.forecastBasis", (s) => s.forecastBasis, (v, s) =>
    v === "average" || v === "median" ? s.update({ forecastBasis: v }) : undefined
  ),

  // Какой разрез данных включён. Сами разрезы — отдельным списком
  // (`cloudSettingsCollections`), здесь только выбор.
  field(useSlicesStore, "slices.activeId", (s) => s.activeId, (v, s) =>
    typeof v === "string" ? s.setActive(v) : undefined
  ),

  // ── Оформление ──
  field(useDisplayStore, "display.fractionDigits", (s) => s.fractionDigits, (v, s) =>
    v === 0 || v === 2 ? s.setFractionDigits(v) : undefined
  ),
  field(useDisplayStore, "display.tableFontLevel", (s) => s.tableFontLevel, (v, s) =>
    v === 1 || v === 2 || v === 3 || v === 4 || v === 5 ? s.setTableFontLevel(v) : undefined
  ),
  field(useDisplayStore, "display.statementLine", (s) => s.statementLine, (v, s) =>
    isBool(v) ? s.setStatementLine(v) : undefined
  ),
  field(useDisplayStore, "display.hideThanks", (s) => s.hideThanks, (v, s) =>
    isBool(v) ? s.setHideThanks(v) : undefined
  ),
  field(useDisplayStore, "display.filtersMode", (s) => s.filtersMode, (v, s) =>
    v === "button" || v === "page" ? s.setFiltersMode(v) : undefined
  ),
  field(useDisplayStore, "display.monthKind", (s) => s.monthKind, (v, s) =>
    v === "period" || v === "month" ? s.setMonthKind(v) : undefined
  ),
  field(useFilterMemoryStore, "filterMemory.enabled", (s) => s.enabled, (v, s) =>
    isBool(v) ? s.setEnabled(v) : undefined
  ),
  field(useMembersStore, "members.aliases", (s) => s.aliases, (v, s) => s.replaceAliases(v)),
  field(useMembersStore, "members.hideForeignPrivate", (s) => s.hideForeignPrivate, (v, s) =>
    isBool(v) ? s.setHideForeignPrivate(v) : undefined
  ),
  // Тема живёт в localStorage и читается синхронно — готова всегда.
  field(
    useThemeStore,
    "theme.mode",
    (s) => s.mode,
    (v, s) => (v === "light" || v === "dark" || v === "auto" ? s.setMode(v) : undefined),
    () => true
  ),
  field(
    useThemeStore,
    "theme.light",
    (s) => s.lightScheme,
    (v, s) => (isLightSchemeId(v) ? s.setScheme(v) : undefined),
    () => true
  ),
  field(
    useThemeStore,
    "theme.dark",
    (s) => s.darkScheme,
    (v, s) => (isDarkSchemeId(v) ? s.setScheme(v) : undefined),
    () => true
  ),

  // ── Главная и меню ──
  field(useDashboardLayoutStore, "home.layout", (s) => s.layout, (v, s) =>
    Array.isArray(v) ? s.replaceLayout(v) : undefined
  ),
  field(useHeaderNavStore, "home.headerNav", (s) => s.items, (v, s) =>
    Array.isArray(v) ? s.replaceItems(v) : undefined
  ),
  field(useHeaderNavStore, "home.headerNavIconsOnly", (s) => s.iconsOnly, (v, s) =>
    isBool(v) ? s.setIconsOnly(v) : undefined
  ),
  field(useHeaderNavStore, "home.headerNavIconWidth", (s) => s.iconWidth, (v, s) =>
    typeof v === "number" ? s.setIconWidth(v) : undefined
  ),
];

export function syncedField(key: string): SyncedField | undefined {
  return SYNCED_FIELDS.find((f) => f.key === key);
}
