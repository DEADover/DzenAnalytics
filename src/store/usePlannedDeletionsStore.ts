// Просроченные запланированные операции, которые человек убрал у себя, но в
// облако это ещё не уехало (issue #71).
//
// Храним не только id операции, но и то, что нужно показать в списке
// изменений — дату, подпись и «весь план или одну дату». После отправки
// операции в кэше уже нет, а строка в списке изменений должна оставаться
// читаемой до самого конца.

import { create } from "zustand";
import * as db from "../lib/db";
import type { PlannedDeletion } from "../lib/zenmoneyPush";

const KEY = "plannedDeletions";

export interface PlannedDeletionEntry extends PlannedDeletion {
  /** «ГГГГ-ММ-ДД» просроченной операции — для строки в списке изменений. */
  date: string;
  /** Подпись операции: контрагент, комментарий или категория. */
  title: string;
}

type Persisted = Record<string, PlannedDeletionEntry>;

interface State {
  deletions: Persisted;
  loaded: boolean;
  hydrate: () => Promise<void>;
  /** Поставить операцию в очередь на удаление (повтор перезаписывает выбор). */
  remove: (entry: PlannedDeletionEntry) => Promise<void>;
  /** Вернуть операцию — удаления не будет. */
  restore: (id: string) => Promise<void>;
  /** Убрать из очереди то, что успешно уехало. */
  clearPushed: (ids: string[]) => Promise<void>;
  clearAll: () => Promise<void>;
}

export const usePlannedDeletionsStore = create<State>((set, get) => {
  async function persist(deletions: Persisted) {
    await db.saveJSON(KEY, deletions);
    set({ deletions });
  }

  return {
    deletions: {},
    loaded: false,

    hydrate: async () => {
      const data = await db.loadJSON<Persisted>(KEY);
      set({ deletions: data || {}, loaded: true });
    },

    remove: async (entry) => {
      await persist({ ...get().deletions, [entry.id]: entry });
    },

    restore: async (id) => {
      const next = { ...get().deletions };
      if (next[id] === undefined) return;
      delete next[id];
      await persist(next);
    },

    clearPushed: async (ids) => {
      if (ids.length === 0) return;
      const next = { ...get().deletions };
      for (const id of ids) delete next[id];
      await persist(next);
    },

    clearAll: async () => {
      await persist({});
    },
  };
});

/** Прочитать очередь без хука — для отправки. */
export async function loadPlannedDeletions(): Promise<Persisted> {
  const s = usePlannedDeletionsStore.getState();
  if (s.loaded) return s.deletions;
  return (await db.loadJSON<Persisted>(KEY)) || {};
}
