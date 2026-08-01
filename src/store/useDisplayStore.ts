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

function applyTableFont(level: TableFontLevel): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--tbl-font", TABLE_FONT_REM[level]);
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
  loaded: boolean;
  hydrate: () => Promise<void>;
  setFractionDigits: (n: FractionDigits) => Promise<void>;
  setTableFontLevel: (level: TableFontLevel) => Promise<void>;
  setStatementLine: (on: boolean) => Promise<void>;
}

export const useDisplayStore = create<DisplayState>((set, get) => ({
  fractionDigits: 0,
  tableFontLevel: DEFAULT_TABLE_FONT_LEVEL,
  statementLine: false,
  loaded: false,

  hydrate: async () => {
    const stored = await db.loadJSON<{
      fractionDigits?: number;
      tableFontLevel?: number;
      statementLine?: boolean;
    }>(KEY);
    const fd: FractionDigits = stored?.fractionDigits === 2 ? 2 : 0;
    const level = normalizeLevel(stored?.tableFontLevel);
    setMoneyFractionDigits(fd); // sync the formatter before first paint
    applyTableFont(level); // sync the CSS var before first paint
    set({
      fractionDigits: fd,
      tableFontLevel: level,
      statementLine: stored?.statementLine === true,
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
}));

/** Всё, что кладём в IDB, — одним местом, чтобы сеттеры не забывали поля. */
function persisted(s: DisplayState) {
  return {
    fractionDigits: s.fractionDigits,
    tableFontLevel: s.tableFontLevel,
    statementLine: s.statementLine,
  };
}
