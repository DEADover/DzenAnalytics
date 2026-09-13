import { create } from "zustand";
import * as db from "../lib/db";
import { DEFAULT_TAG_MODE, type TagMode } from "../lib/operationTags";

/**
 * Что сервис считает тегами операции (#69): хэштеги из комментария или вторые
 * категории. См. `lib/operationTags`.
 *
 * По умолчанию — хэштеги: так теги работали всегда, и у тех, кто ими
 * пользуется, после обновления ничего не должно поменяться само.
 */
interface State {
  mode: TagMode;
  loaded: boolean;
  hydrate: () => Promise<void>;
  setMode: (mode: TagMode) => Promise<void>;
}

const KEY = "tagMode";

export const useTagModeStore = create<State>((set) => ({
  mode: DEFAULT_TAG_MODE,
  loaded: false,
  hydrate: async () => {
    const saved = await db.loadJSON<unknown>(KEY);
    set({
      mode: saved === "categories" ? "categories" : DEFAULT_TAG_MODE,
      loaded: true,
    });
  },
  setMode: async (mode) => {
    set({ mode });
    await db.saveJSON(KEY, mode);
  },
}));
