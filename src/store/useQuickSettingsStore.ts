import { create } from "zustand";
import * as db from "../lib/db";
import { moveItem } from "../lib/headerNav";
import { DEFAULT_QUICK_SETTINGS, normalizeQuickSettings } from "../lib/quickSettings";

/**
 * Какие пункты стоят в панели быстрых настроек (`lib/quickSettings`) и в каком
 * порядке, и открыт ли редактор. Устроено как меню шапки (`useHeaderNavStore`):
 * правка применяется сразу и переносится на другие устройства.
 */
interface State {
  items: string[];
  loaded: boolean;
  editorOpen: boolean;
  hydrate: () => Promise<void>;
  add: (id: string) => void;
  remove: (id: string) => void;
  move: (id: string, dir: -1 | 1) => void;
  reset: () => void;
  openEditor: () => void;
  closeEditor: () => void;
  /** Заменить набор целиком — пришедший с другого устройства. */
  replaceItems: (raw: unknown) => void;
}

const KEY = "quickSettings";

export const useQuickSettingsStore = create<State>((set, get) => {
  const save = (items: string[]) => {
    set({ items });
    void db.saveJSON(KEY, items);
  };
  return {
    items: [...DEFAULT_QUICK_SETTINGS],
    loaded: false,
    editorOpen: false,
    hydrate: async () => {
      const saved = await db.loadJSON<unknown>(KEY);
      set({ items: normalizeQuickSettings(saved), loaded: true });
    },
    add: (id) => {
      if (get().items.includes(id)) return;
      save(normalizeQuickSettings([...get().items, id]));
    },
    remove: (id) => save(get().items.filter((x) => x !== id)),
    move: (id, dir) => save(moveItem(get().items, id, dir)),
    reset: () => save([...DEFAULT_QUICK_SETTINGS]),
    replaceItems: (raw) => save(normalizeQuickSettings(raw)),
    openEditor: () => set({ editorOpen: true }),
    closeEditor: () => set({ editorOpen: false }),
  };
});
