/**
 * Режим столбцов разницы («₽», «%», «₽ и %») — по таблицам.
 *
 * Как и свои ширины столбцов (`useColumnWidthsStore`): лежит в базе аккаунта,
 * едет в бэкап, между устройствами не синхронизируется — это привычка
 * смотреть, а не данные. Таблица подписана только на свою запись.
 */

import { useCallback } from "react";
import { create } from "zustand";
import * as db from "../lib/db";
import { isDiffMode, type DiffMode } from "../lib/diffMode";

const KEY = "diffModes";

interface DiffModeState {
  /** Таблица → выбранный режим. Нет записи — режим таблицы по умолчанию. */
  tables: Record<string, DiffMode>;
  hydrate: () => Promise<void>;
  setMode: (table: string, mode: DiffMode) => void;
}

function clean(raw: unknown): Record<string, DiffMode> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, DiffMode> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isDiffMode(v)) out[id] = v;
  }
  return out;
}

export const useDiffModeStore = create<DiffModeState>((set, get) => ({
  tables: {},

  hydrate: async () => {
    const stored = await db.loadJSON<unknown>(KEY);
    // Поверх того, что успели переключить до конца загрузки.
    set({ tables: { ...clean(stored), ...get().tables } });
  },

  setMode: (table, mode) => {
    const tables = { ...get().tables, [table]: mode };
    set({ tables });
    void db.saveJSON(KEY, tables);
  },
}));

/** Режим столбца разницы таблицы `table` и как его сменить. */
export function useDiffMode(table: string, fallback: DiffMode): [DiffMode, (mode: DiffMode) => void] {
  const mode = useDiffModeStore((s) => s.tables[table]) ?? fallback;
  const setMode = useDiffModeStore((s) => s.setMode);
  const set = useCallback((m: DiffMode) => setMode(table, m), [setMode, table]);
  return [mode, set];
}
