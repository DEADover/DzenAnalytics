import { create } from "zustand";
import * as db from "../lib/db";
import type { UserAliases } from "../lib/zenUsers";
import { useDataStore } from "./useDataStore";
import { invalidateLiveAccounts } from "./useZenmoneyStore";

/**
 * Настройки участников общего аккаунта Дзен-мани (issues #92, #95).
 *
 * Сам Дзен-мани знает про человека логин и почту, но в фильтре «Жена» и «Сын»
 * полезнее, чем «user4821» — а почту чужого человека показывать и вовсе
 * незачем. Псевдоним живёт только здесь, в Дзен-мани не уезжает: это наша
 * подпись, а не правка чужого профиля.
 *
 * Хранится под ключом `userAliases` как «номер пользователя → имя».
 */
interface MembersState {
  aliases: UserAliases;
  /**
   * Кто из участников — вы. Спрашиваем, а не угадываем.
   *
   * По ответу API владельца токена не отличить: `user[]` у разных участников
   * совпадает байт в байт (проверено на живом общем аккаунте). Угадывать здесь
   * нельзя: от ответа зависит, чьи личные счета прятать, и ошибка означала бы
   * спрятать своё и показать чужое.
   *
   * `null` — человек ещё не ответил. Тогда НИЧЕГО не прячем: молча спрятать
   * чужое и своё вперемешку хуже, чем показать всё и спросить.
   */
  ownerId: number | null;
  /**
   * Прятать личные счета остальных участников (#95).
   *
   * Дзен-мани прячет их в приложении и на сайте, а по API отдаёт всё. Пометка
   * «личный» — обещание, данное тем, кто её поставил, поэтому по умолчанию
   * прячем. Выключается для тех, кому нужнее видеть операции всех.
   *
   * Работает только вместе с `ownerId`: не зная, кто вы, прятать нечего.
   *
   * НА ДИСКЕ ХРАНИТСЯ ОБРАТНОЕ — ключ `membersShowForeign`, умолчание `false`.
   * Так вышло не от хорошей жизни: `db.loadJSON` возвращает `value || null`, и
   * сохранённое `false` читается обратно как `null`, неотличимо от «никогда не
   * задавали». Настройка с умолчанием `true` через него не выражается вовсе —
   * переключатель молча не выключался. Все прочие булевы в проекте живут с
   * умолчанием `false` и читаются как `=== true`; держимся того же правила.
   */
  hideForeignPrivate: boolean;
  loaded: boolean;
  hydrate: () => Promise<void>;
  /** Задать имя. Пустое — снять псевдоним и вернуться к логину. */
  setAlias: (userId: number, name: string) => Promise<void>;
  setOwnerId: (userId: number | null) => Promise<void>;
  setHideForeignPrivate: (v: boolean) => Promise<void>;
  clearAll: () => Promise<void>;
}

export const useMembersStore = create<MembersState>((set, get) => ({
  aliases: {},
  ownerId: null,
  hideForeignPrivate: true,
  loaded: false,

  hydrate: async () => {
    const [data, owner, showForeign] = await Promise.all([
      db.loadJSON<UserAliases>("userAliases"),
      db.loadJSON<number>("userOwner"),
      db.loadJSON<boolean>("membersShowForeign"),
    ]);
    // Чужой или испорченный файл не должен превращаться в объект со всякой
    // всячиной: берём только строковые значения.
    const clean: UserAliases = {};
    if (data && typeof data === "object" && !Array.isArray(data)) {
      for (const [k, v] of Object.entries(data)) {
        if (typeof v === "string" && v.trim()) clean[k] = v.trim();
      }
    }
    set({
      aliases: clean,
      ownerId: typeof owner === "number" ? owner : null,
      hideForeignPrivate: showForeign !== true,
      loaded: true,
    });
  },

  setHideForeignPrivate: async (v) => {
    await db.saveJSON("membersShowForeign", !v);
    set({ hideForeignPrivate: v });
    // Списки пересобираются из неизменного сырого набора — дёшево и мгновенно.
    invalidateLiveAccounts();
    await useDataStore.getState().refresh();
  },

  setOwnerId: async (userId) => {
    await db.saveJSON("userOwner", userId);
    set({ ownerId: userId });
    invalidateLiveAccounts();
    await useDataStore.getState().refresh();
  },

  setAlias: async (userId, name) => {
    const key = String(userId);
    const value = name.trim();
    const next = { ...get().aliases };
    if (value) next[key] = value;
    else delete next[key];
    await db.saveJSON("userAliases", next);
    set({ aliases: next });
  },

  clearAll: async () => {
    await Promise.all([
      db.saveJSON("userAliases", {}),
      db.saveJSON("userOwner", null),
      db.saveJSON("membersShowForeign", false),
    ]);
    set({ aliases: {}, ownerId: null, hideForeignPrivate: true });
    invalidateLiveAccounts();
    await useDataStore.getState().refresh();
  },
}));
