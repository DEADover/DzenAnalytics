import { create } from "zustand";
import * as db from "../lib/db";
import type { ForecastBasis } from "../lib/budgetForecast";
import type { BudgetRowOrder } from "../lib/budgets";

/**
 * Настройки бюджета — свои, а не общие «Разрезы данных».
 *
 * Бюджет читает операции напрямую и разрезами не управляется намеренно:
 * разрезы — глобальный инструмент аналитики, и менять ими план с фактом было бы
 * неожиданно. Здесь же отбор счетов — часть самого бюджета: это его периметр.
 */
/** Три вида раздела: месяц, годовой свод и сводка по году. */
export type BudgetView = "month" | "year" | "dashboard";

export interface BudgetSettings {
  /** Счета в бюджете. Пустой список = все (соглашение фильтров сервиса). */
  accounts: string[];
  /** Считать переводы, пересекающие границу периметра. */
  perimeterTransfers: boolean;
  /** С какого вида открывать раздел. */
  defaultView: BudgetView;
  /** Порядок статей в списках и в выгрузках. */
  rowOrder: BudgetRowOrder;
  /** Прятать статьи, по которым за период не было ни одной операции. */
  hideEmptyRows: boolean;
  /** Окно прогноза по умолчанию в окне «Заполнить по среднему». */
  forecastMonths: number;
  forecastBasis: ForecastBasis;
}

export const DEFAULT_BUDGET_SETTINGS: BudgetSettings = {
  accounts: [],
  perimeterTransfers: false,
  defaultView: "month",
  rowOrder: "alpha",
  hideEmptyRows: true,
  forecastMonths: 3,
  forecastBasis: "average",
};

const KEY = "budgetSettings";

interface State extends BudgetSettings {
  loaded: boolean;
  hydrate: () => Promise<void>;
  update: (patch: Partial<BudgetSettings>) => Promise<void>;
}

export const useBudgetSettingsStore = create<State>((set, get) => ({
  ...DEFAULT_BUDGET_SETTINGS,
  loaded: false,

  hydrate: async () => {
    const stored = await db.loadJSON<Partial<BudgetSettings>>(KEY);
    // Раскладываем поверх значений по умолчанию: настройка, добавленная позже,
    // не должна оказаться undefined у тех, кто сохранился до неё.
    set({ ...DEFAULT_BUDGET_SETTINGS, ...(stored ?? {}), loaded: true });
  },

  update: async (patch) => {
    const next = { ...pick(get()), ...patch };
    await db.saveJSON(KEY, next);
    set(next);
  },
}));

/** Только сохраняемые поля — `loaded` и методы на диск не едут. */
function pick(s: BudgetSettings): BudgetSettings {
  return {
    accounts: s.accounts,
    perimeterTransfers: s.perimeterTransfers,
    defaultView: s.defaultView,
    rowOrder: s.rowOrder,
    hideEmptyRows: s.hideEmptyRows,
    forecastMonths: s.forecastMonths,
    forecastBasis: s.forecastBasis,
  };
}
