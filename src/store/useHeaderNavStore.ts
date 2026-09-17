import { create } from "zustand";
import * as db from "../lib/db";
import { DEFAULT_HEADER_NAV, moveItem, normalizeHeaderNav, normalizeIconWidth } from "../lib/headerNav";

/**
 * Какие разделы стоят в меню шапки (`lib/headerNav`), как они показаны
 * (с названиями или одними значками) и открыт ли редактор.
 * Правка применяется сразу — шапку видно за окном редактора.
 */
interface State {
  items: string[];
  /** Пункты меню — одними значками, название в подсказке при наведении. */
  iconsOnly: boolean;
  /** Ступень ширины кнопок в виде «Только значки»: 0 — стандартная, до 10. */
  iconWidth: number;
  loaded: boolean;
  editorOpen: boolean;
  hydrate: () => Promise<void>;
  add: (to: string) => void;
  remove: (to: string) => void;
  move: (to: string, dir: -1 | 1) => void;
  setIconsOnly: (on: boolean) => void;
  setIconWidth: (level: number) => void;
  /** Стандартный вид: четыре основных раздела с названиями. */
  reset: () => void;
  openEditor: () => void;
  closeEditor: () => void;
  /** Заменить разделы целиком — пришедшие с другого устройства; незнакомые пути отсекаются. */
  replaceItems: (raw: unknown) => void;
}

const KEY = "headerNav";
const ICONS_ONLY_KEY = "headerNavIconsOnly";
const ICON_WIDTH_KEY = "headerNavIconWidth";

export const useHeaderNavStore = create<State>((set, get) => {
  const save = (items: string[]) => {
    set({ items });
    void db.saveJSON(KEY, items);
  };
  return {
    items: [...DEFAULT_HEADER_NAV],
    iconsOnly: false,
    iconWidth: 0,
    replaceItems: (raw) => save(normalizeHeaderNav(raw)),
    loaded: false,
    editorOpen: false,
    hydrate: async () => {
      const [saved, iconsOnly, iconWidth] = await Promise.all([
        db.loadJSON<unknown>(KEY),
        db.loadJSON<unknown>(ICONS_ONLY_KEY),
        db.loadJSON<unknown>(ICON_WIDTH_KEY),
      ]);
      set({
        items: normalizeHeaderNav(saved),
        iconsOnly: iconsOnly === true,
        iconWidth: normalizeIconWidth(iconWidth),
        loaded: true,
      });
    },
    add: (to) => {
      if (get().items.includes(to)) return;
      save(normalizeHeaderNav([...get().items, to]));
    },
    remove: (to) => save(get().items.filter((x) => x !== to)),
    move: (to, dir) => save(moveItem(get().items, to, dir)),
    setIconsOnly: (on) => {
      set({ iconsOnly: on });
      void db.saveJSON(ICONS_ONLY_KEY, on);
    },
    setIconWidth: (level) => {
      const l = normalizeIconWidth(level);
      set({ iconWidth: l });
      void db.saveJSON(ICON_WIDTH_KEY, l);
    },
    reset: () => {
      save([...DEFAULT_HEADER_NAV]);
      get().setIconsOnly(false);
      get().setIconWidth(0);
    },
    openEditor: () => set({ editorOpen: true }),
    closeEditor: () => set({ editorOpen: false }),
  };
});
