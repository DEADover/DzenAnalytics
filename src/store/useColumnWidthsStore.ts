/**
 * Свои ширины столбцов — по таблицам.
 *
 * Отдельно от `useDisplayStore`: на него подписан `App`, и каждое
 * перетаскивание границы перерисовывало бы всё дерево. Здесь подписаны
 * только сами таблицы, и каждая — только на свою запись.
 *
 * Лежит в базе аккаунта и едет в копию вместе с оформлением. Между
 * устройствами не синхронизируется: ширины подбирают под свой экран.
 */

import { create } from "zustand";
import * as db from "../lib/db";
import type { ColumnWidthMap } from "../lib/columnResize";

const KEY = "columnWidths";

interface ColumnWidthsState {
  /** Таблица → колонка → `rem` при обычном размере текста. */
  tables: Record<string, ColumnWidthMap>;
  loaded: boolean;
  hydrate: () => Promise<void>;
  /** Записать ширины таблицы; `null` — вернуть ширины по умолчанию. */
  setTable: (id: string, map: ColumnWidthMap | null) => void;
  resetAll: () => void;
}

function clean(raw: unknown): Record<string, ColumnWidthMap> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, ColumnWidthMap> = {};
  for (const [id, map] of Object.entries(raw as Record<string, unknown>)) {
    if (!map || typeof map !== "object") continue;
    const cols: ColumnWidthMap = {};
    for (const [k, v] of Object.entries(map as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) cols[k] = v;
    }
    if (Object.keys(cols).length > 0) out[id] = cols;
  }
  return out;
}

export const useColumnWidthsStore = create<ColumnWidthsState>((set, get) => ({
  tables: {},
  loaded: false,

  hydrate: async () => {
    const stored = await db.loadJSON<unknown>(KEY);
    set({ tables: clean(stored), loaded: true });
  },

  setTable: (id, map) => {
    const tables = { ...get().tables };
    if (map && Object.keys(map).length > 0) tables[id] = map;
    else delete tables[id];
    set({ tables });
    void db.saveJSON(KEY, tables);
  },

  resetAll: () => {
    set({ tables: {} });
    void db.saveJSON(KEY, {});
  },
}));
