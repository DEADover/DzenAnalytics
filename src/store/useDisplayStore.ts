// User display preferences (persisted): the "show kopecks" toggle and the
// table text-size scale.
//
// Money formatting lives in lib/format.ts as a module variable
// (`setMoneyFractionDigits`) so every formatMoney call follows it without
// threading the setting through props. This store mirrors it into React
// state so components re-render when it changes (App subscribes to it,
// cascading a re-render across the tree).
//
// The table font scale is applied as a CSS variable (`--tbl-font`) on the
// document root; the operation tables / feed read it, so changing the level
// rescales their text with no React re-render needed.

import { create } from "zustand";
import * as db from "../lib/db";
import { setMoneyFractionDigits } from "../lib/format";

const KEY = "displaySettings";

type FractionDigits = 0 | 2;

/**
 * Где живут общие фильтры: `button` — панелью из-под шапки по кнопке (не
 * занимают места, вызываются с любой прокрутки), `page` — первым блоком
 * страницы, как было раньше; кнопки в шапке тогда нет вовсе.
 */
export type FiltersMode = "button" | "page";

/** 1 (smallest) … 5 (largest); 3 is the default 14px baseline. */
export type TableFontLevel = 1 | 2 | 3 | 4 | 5;

// Level → font-size for operation tables. Each step is 1px at a 16px root.
// Level 3 = 0.875rem (14px) is the unified default.
const TABLE_FONT_REM: Record<TableFontLevel, string> = {
  1: "0.75rem", // 12px
  2: "0.8125rem", // 13px
  3: "0.875rem", // 14px (default)
  4: "0.9375rem", // 15px
  5: "1rem", // 16px
};

export const DEFAULT_TABLE_FONT_LEVEL: TableFontLevel = 3;

/** Во сколько раз текст таблиц крупнее обычных 14 px — множитель ширин колонок. */
const TABLE_FONT_SCALE: Record<TableFontLevel, string> = {
  1: String(12 / 14),
  2: String(13 / 14),
  3: "1",
  4: String(15 / 14),
  5: String(16 / 14),
};

function applyTableFont(level: TableFontLevel): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--tbl-font", TABLE_FONT_REM[level]);
  document.documentElement.style.setProperty("--tbl-scale", TABLE_FONT_SCALE[level]);
}

function normalizeLevel(n: unknown): TableFontLevel {
  const v = Math.round(Number(n));
  return (v >= 1 && v <= 5 ? v : DEFAULT_TABLE_FONT_LEVEL) as TableFontLevel;
}

interface DisplayState {
  /** Fraction digits for money: 0 = whole amounts, 2 = kopecks/cents. */
  fractionDigits: FractionDigits;
  /** Operation-table text size, 1 (small) … 5 (large). */
  tableFontLevel: TableFontLevel;
  /**
   * Что показывать второй строкой под контрагентом в ленте «Операции»:
   * `false` — свободный текст получателя (как было), `true` — строку из
   * банковской выписки. Второе полезно при оплате по СБП и через
   * посредников: контрагент говорит «AliExpress», а деньги ушли «Сергей Г.».
   */
  statementLine: boolean;
  /**
   * Раскрыт ли журнал синхронизаций.
   *
   * По умолчанию свёрнут: это отладочная история, её открывают, когда что-то
   * пошло не так, а место она занимала на пол-экрана постоянно.
   *
   * Живёт здесь, а не в состоянии компонента, по трём причинам сразу: вид
   * должен пережить перезагрузку, вернуться при следующем заходе и попасть в
   * копию данных сервиса. `displaySettings` уже умеет всё три — он один
   * объект под одним ключом и входит в бэкап.
   */
  syncLogOpen: boolean;
  /**
   * Спрятать значок-сердечко «Отблагодарить автора» в шапке и строку в меню
   * телефона. По умолчанию значок есть: раньше ссылка стояла в подвале.
   */
  hideThanks: boolean;
  filtersMode: FiltersMode;
  loaded: boolean;
  hydrate: () => Promise<void>;
  setFractionDigits: (n: FractionDigits) => Promise<void>;
  setTableFontLevel: (level: TableFontLevel) => Promise<void>;
  setStatementLine: (on: boolean) => Promise<void>;
  setSyncLogOpen: (on: boolean) => Promise<void>;
  setHideThanks: (on: boolean) => Promise<void>;
  setFiltersMode: (mode: FiltersMode) => Promise<void>;
}

export const useDisplayStore = create<DisplayState>((set, get) => ({
  fractionDigits: 0,
  tableFontLevel: DEFAULT_TABLE_FONT_LEVEL,
  statementLine: false,
  syncLogOpen: false,
  hideThanks: false,
  filtersMode: "page",
  loaded: false,

  hydrate: async () => {
    const stored = await db.loadJSON<{
      fractionDigits?: number;
      tableFontLevel?: number;
      statementLine?: boolean;
      syncLogOpen?: boolean;
      hideThanks?: boolean;
      filtersMode?: string;
    }>(KEY);
    const fd: FractionDigits = stored?.fractionDigits === 2 ? 2 : 0;
    const level = normalizeLevel(stored?.tableFontLevel);
    setMoneyFractionDigits(fd); // sync the formatter before first paint
    applyTableFont(level); // sync the CSS var before first paint
    set({
      fractionDigits: fd,
      tableFontLevel: level,
      statementLine: stored?.statementLine === true,
      syncLogOpen: stored?.syncLogOpen === true,
      hideThanks: stored?.hideThanks === true,
      // По умолчанию фильтры стоят на странице; панель по кнопке — выбор человека.
      filtersMode: stored?.filtersMode === "button" ? "button" : "page",
      loaded: true,
    });
  },

  setFractionDigits: async (n) => {
    setMoneyFractionDigits(n); // update the formatter FIRST…
    set({ fractionDigits: n }); // …then trigger a re-render of subscribers
    await db.saveJSON(KEY, { ...persisted(get()), fractionDigits: n });
  },

  setTableFontLevel: async (level) => {
    const lvl = normalizeLevel(level);
    applyTableFont(lvl);
    set({ tableFontLevel: lvl });
    await db.saveJSON(KEY, { ...persisted(get()), tableFontLevel: lvl });
  },

  setStatementLine: async (on) => {
    set({ statementLine: on });
    await db.saveJSON(KEY, { ...persisted(get()), statementLine: on });
  },

  setSyncLogOpen: async (on) => {
    set({ syncLogOpen: on });
    await db.saveJSON(KEY, { ...persisted(get()), syncLogOpen: on });
  },

  setHideThanks: async (on) => {
    set({ hideThanks: on });
    await db.saveJSON(KEY, { ...persisted(get()), hideThanks: on });
  },

  setFiltersMode: async (filtersMode) => {
    set({ filtersMode });
    await db.saveJSON(KEY, { ...persisted(get()), filtersMode });
  },
}));

/** Всё, что кладём в IDB, — одним местом, чтобы сеттеры не забывали поля. */
function persisted(s: DisplayState) {
  return {
    fractionDigits: s.fractionDigits,
    tableFontLevel: s.tableFontLevel,
    statementLine: s.statementLine,
    syncLogOpen: s.syncLogOpen,
    hideThanks: s.hideThanks,
    filtersMode: s.filtersMode,
  };
}
