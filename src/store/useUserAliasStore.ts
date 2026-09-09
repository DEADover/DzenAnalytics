import { create } from "zustand";
import * as db from "../lib/db";
import type { UserAliases } from "../lib/zenUsers";

/**
 * Как звать людей на общем аккаунте Дзен-мани (issue #92).
 *
 * Сам Дзен-мани знает про человека логин и почту, но в фильтре «Жена» и «Сын»
 * полезнее, чем «user4821» — а почту чужого человека показывать и вовсе
 * незачем. Псевдоним живёт только здесь, в Дзен-мани не уезжает: это наша
 * подпись, а не правка чужого профиля.
 *
 * Хранится под ключом `userAliases` как «номер пользователя → имя».
 */
interface UserAliasState {
  aliases: UserAliases;
  /**
   * Кого считать собой — если догадка ошиблась.
   *
   * Дзен-мани не помечает хозяина токена явно, и `guessOwnerId` берёт того, у
   * кого нет «родителя». Догадка проверена не была, поэтому у человека должно
   * быть чем её поправить: от неё зависит, чьи плановые операции показывать.
   * `null` — доверяем догадке.
   */
  ownerId: number | null;
  loaded: boolean;
  hydrate: () => Promise<void>;
  /** Задать имя. Пустое — снять псевдоним и вернуться к логину. */
  setAlias: (userId: number, name: string) => Promise<void>;
  setOwnerId: (userId: number | null) => Promise<void>;
  clearAll: () => Promise<void>;
}

export const useUserAliasStore = create<UserAliasState>((set, get) => ({
  aliases: {},
  ownerId: null,
  loaded: false,

  hydrate: async () => {
    const [data, owner] = await Promise.all([
      db.loadJSON<UserAliases>("userAliases"),
      db.loadJSON<number>("userOwner"),
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
      loaded: true,
    });
  },

  setOwnerId: async (userId) => {
    await db.saveJSON("userOwner", userId);
    set({ ownerId: userId });
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
    await Promise.all([db.saveJSON("userAliases", {}), db.saveJSON("userOwner", null)]);
    set({ aliases: {}, ownerId: null });
  },
}));
