// Действия с запланированными операциями, ещё не уехавшие в облако:
// «Сохранить как факт», «Связать план с фактом», «Изменить» (см.
// `lib/planActions`). Удаление даты и цепочки — в `usePlannedDeletionsStore`.
//
// Ключ — id даты плана (`reminderMarker`): у одной даты одно намерение, и
// новое действие заменяет прежнее (сначала поправили сумму, потом закрыли
// фактом — уедет факт).

import { create } from "zustand";
import * as db from "../lib/db";
import { serialQueue } from "../lib/serialQueue";
import type { PlanAction } from "../lib/planActions";

const KEY = "planActions";

type Persisted = Record<string, PlanAction>;

interface State {
  actions: Persisted;
  loaded: boolean;
  hydrate: () => Promise<void>;
  put: (action: PlanAction) => Promise<void>;
  /** Отменить действие — в списке изменений и при удалении черновика факта. */
  revert: (markerId: string) => Promise<void>;
  clearPushed: (markerIds: string[]) => Promise<void>;
  clearAll: () => Promise<void>;
}

/** Действия по одному — без гонки «прочитал → записал» (lib/serialQueue). */
const queue = serialQueue();

export const usePlanActionsStore = create<State>((set, get) => {
  async function persist(actions: Persisted) {
    await db.saveJSON(KEY, actions);
    set({ actions });
  }
  return {
    actions: {},
    loaded: false,
    hydrate: () => queue(async () => {
      const data = await db.loadJSON<Persisted>(KEY);
      set({ actions: data || {}, loaded: true });
    }),
    put: (action) => queue(async () => {
      await persist({ ...get().actions, [action.markerId]: action });
    }),
    revert: (markerId) => queue(async () => {
      if (get().actions[markerId] === undefined) return;
      const next = { ...get().actions };
      delete next[markerId];
      await persist(next);
    }),
    clearPushed: (markerIds) => queue(async () => {
      if (markerIds.length === 0) return;
      const next = { ...get().actions };
      for (const id of markerIds) delete next[id];
      await persist(next);
    }),
    clearAll: () => queue(async () => {
      await persist({});
    }),
  };
});

/** Прочитать очередь без хука — для отправки. */
export async function loadPlanActions(): Promise<Persisted> {
  const s = usePlanActionsStore.getState();
  if (s.loaded) return s.actions;
  return (await db.loadJSON<Persisted>(KEY)) || {};
}
