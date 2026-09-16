import { create } from "zustand";
import * as db from "../lib/db";
import { DEFAULT_HEADER_NAV, moveItem, normalizeHeaderNav } from "../lib/headerNav";

/**
 * Какие разделы стоят в меню шапки (`lib/headerNav`) и открыт ли редактор.
 * Правка применяется сразу — шапку видно за окном редактора.
 */
interface State {
  items: string[];
  loaded: boolean;
  editorOpen: boolean;
  hydrate: () => Promise<void>;
  add: (to: string) => void;
  remove: (to: string) => void;
  move: (to: string, dir: -1 | 1) => void;
  reset: () => void;
  openEditor: () => void;
  closeEditor: () => void;
  /** Заменить разделы целиком — пришедшие с другого устройства; незнакомые пути отсекаются. */
  replaceItems: (raw: unknown) => void;
}

const KEY = "headerNav";

export const useHeaderNavStore = create<State>((set, get) => {
  const save = (items: string[]) => {
    set({ items });
    void db.saveJSON(KEY, items);
  };
  return {
    items: [...DEFAULT_HEADER_NAV],
    replaceItems: (raw) => save(normalizeHeaderNav(raw)),
    loaded: false,
    editorOpen: false,
    hydrate: async () => {
      const saved = await db.loadJSON<unknown>(KEY);
      set({ items: normalizeHeaderNav(saved), loaded: true });
    },
    add: (to) => {
      if (get().items.includes(to)) return;
      save(normalizeHeaderNav([...get().items, to]));
    },
    remove: (to) => save(get().items.filter((x) => x !== to)),
    move: (to, dir) => save(moveItem(get().items, to, dir)),
    reset: () => save([...DEFAULT_HEADER_NAV]),
    openEditor: () => set({ editorOpen: true }),
    closeEditor: () => set({ editorOpen: false }),
  };
});
