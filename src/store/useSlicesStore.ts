import { create } from "zustand";
import * as db from "../lib/db";

/**
 * Разрезы данных (issue #14).
 *
 * Разрез отвечает на вопрос «что считать своими финансами в этой картине»:
 * какие категории и какие счета НЕ участвуют в сводной аналитике. Обороты,
 * взаимозачёты и возмещения раздувают доход и расход, не будучи ни тем ни
 * другим; у кого-то рядом лежит бизнес, который в личную картину попадать не
 * должен. Раньше это был один общий список исключённых категорий — теперь их
 * может быть несколько, под именами, и они переключаются одной кнопкой.
 *
 * Разрез действует ТОЛЬКО на сводную аналитику (Здоровье, FIRE, Что-если, Год
 * в цифрах, Дайджест, Аномалии, Сравнение, Динамика, Отчёт) — там, где считается
 * единая картина «доход / расход / поток». Список операций разрез не прячет:
 * реестр должен показывать всё, иначе правки делались бы вслепую.
 *
 * Ключи категорий совпадают с ключами `categoryMeta`: корневая — по названию
 * («Переводы»), подкатегория — полным путём («Родитель / Подкатегория»).
 * Исключение корневой охватывает её подкатегории. Счета — по названию, как
 * везде в фильтрах.
 *
 * Хранится своим блобом в IDB и в облако не уезжает: это понятие
 * DzenAnalytics, в Дзен-мани такого нет.
 */
export interface Slice {
  id: string;
  name: string;
  /** Категории вне аналитики. */
  excludedCategories: string[];
  /** Счета вне аналитики (по названию). */
  excludedAccounts: string[];
}

interface Persisted {
  slices: Slice[];
  activeId: string;
}

interface State extends Persisted {
  loaded: boolean;
  hydrate: () => Promise<void>;
  setActive: (id: string) => Promise<void>;
  add: (name: string, copyFromId?: string) => Promise<string>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Переключить категорию в разрезе (по умолчанию — в активном). */
  toggleCategory: (category: string, sliceId?: string) => Promise<void>;
  /** Задать список исключённых счетов целиком — так работает пикер. */
  setAccounts: (sliceId: string, accounts: string[]) => Promise<void>;
  setCategories: (sliceId: string, categories: string[]) => Promise<void>;
}

const KEY = "dataSlices";
/** Ключ старой настройки — из неё собирается первый разрез при обновлении. */
const LEGACY_KEY = "analyticsExcludedCategories";

export const DEFAULT_SLICE_ID = "default";
export const DEFAULT_SLICE_NAME = "Все данные";

function emptyDefault(excludedCategories: string[] = []): Persisted {
  return {
    slices: [
      {
        id: DEFAULT_SLICE_ID,
        name: DEFAULT_SLICE_NAME,
        excludedCategories,
        excludedAccounts: [],
      },
    ],
    activeId: DEFAULT_SLICE_ID,
  };
}

export const useSlicesStore = create<State>((set, get) => {
  async function persist(next: Persisted) {
    await db.saveJSON(KEY, next);
    set(next);
  }
  function snapshot(): Persisted {
    const s = get();
    return { slices: s.slices, activeId: s.activeId };
  }
  function patch(id: string, fn: (s: Slice) => Slice): Promise<void> {
    const s = snapshot();
    return persist({ ...s, slices: s.slices.map((x) => (x.id === id ? fn(x) : x)) });
  }

  return {
    ...emptyDefault(),
    loaded: false,

    hydrate: async () => {
      const data = await db.loadJSON<Partial<Persisted>>(KEY);
      if (data && Array.isArray(data.slices) && data.slices.length > 0) {
        const activeId = data.slices.some((s) => s.id === data.activeId)
          ? data.activeId!
          : data.slices[0].id;
        set({ slices: data.slices, activeId, loaded: true });
        return;
      }
      // Первый запуск после обновления: старый список исключённых категорий
      // становится разрезом «Все данные», ничего не теряя.
      const legacy = await db.loadJSON<string[]>(LEGACY_KEY);
      const seeded = emptyDefault(Array.isArray(legacy) ? legacy : []);
      set({ ...seeded, loaded: true });
      if (Array.isArray(legacy) && legacy.length > 0) await db.saveJSON(KEY, seeded);
    },

    setActive: async (id) => {
      const s = snapshot();
      if (!s.slices.some((x) => x.id === id)) return;
      await persist({ ...s, activeId: id });
    },

    add: async (name, copyFromId) => {
      const s = snapshot();
      const from = s.slices.find((x) => x.id === copyFromId);
      const id = crypto.randomUUID();
      const slice: Slice = {
        id,
        name: name.trim() || "Новый разрез",
        excludedCategories: from ? [...from.excludedCategories] : [],
        excludedAccounts: from ? [...from.excludedAccounts] : [],
      };
      await persist({ slices: [...s.slices, slice], activeId: id });
      return id;
    },

    rename: async (id, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      await patch(id, (x) => ({ ...x, name: trimmed }));
    },

    remove: async (id) => {
      const s = snapshot();
      // Последний разрез не удаляем: без него аналитике не на что опираться.
      if (s.slices.length <= 1) return;
      const slices = s.slices.filter((x) => x.id !== id);
      const activeId = s.activeId === id ? slices[0].id : s.activeId;
      await persist({ slices, activeId });
    },

    toggleCategory: async (category, sliceId) => {
      const s = snapshot();
      const id = sliceId ?? s.activeId;
      await patch(id, (x) => ({
        ...x,
        excludedCategories: x.excludedCategories.includes(category)
          ? x.excludedCategories.filter((c) => c !== category)
          : [...x.excludedCategories, category],
      }));
    },

    setAccounts: async (sliceId, accounts) => {
      await patch(sliceId, (x) => ({ ...x, excludedAccounts: [...accounts] }));
    },

    setCategories: async (sliceId, categories) => {
      await patch(sliceId, (x) => ({ ...x, excludedCategories: [...categories] }));
    },
  };
});

/** Активный разрез — или разрез по умолчанию, пока хранилище не поднялось. */
export function activeSlice(s: Pick<State, "slices" | "activeId">): Slice {
  return s.slices.find((x) => x.id === s.activeId) ?? emptyDefault().slices[0];
}
