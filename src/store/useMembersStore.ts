import { create } from "zustand";
import * as db from "../lib/db";
import type { UserAliases } from "../lib/zenUsers";

/**
 * Кто перестраивается, когда меняется, чьё видно (кто вы, прятать ли чужие
 * личные счета). Хранилище участников само никого не зовёт — иначе ему пришлось
 * бы импортировать хранилища данных и Дзен-мани, а они импортируют его: круг
 * импортов, который при неудачном порядке загрузки ронял приложение на старте.
 * Наоборот, они подписываются сюда сами (`onMembersVisibilityChange`).
 *
 * `order` — порядок вызова: список счетов сбрасывается раньше (0), чем
 * пересобираются операции (1). Действия ждут всех подписчиков.
 */
const visibilityListeners: { fn: () => void | Promise<void>; order: number }[] = [];

export function onMembersVisibilityChange(fn: () => void | Promise<void>, order = 0): () => void {
  const entry = { fn, order };
  visibilityListeners.push(entry);
  visibilityListeners.sort((a, b) => a.order - b.order);
  return () => {
    const i = visibilityListeners.indexOf(entry);
    if (i >= 0) visibilityListeners.splice(i, 1);
  };
}

async function visibilityChanged(): Promise<void> {
  for (const l of visibilityListeners) await l.fn();
}

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
  /** Заменить имена участников целиком — пришедшие с другого устройства. */
  replaceAliases: (raw: unknown) => Promise<void>;
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
    await visibilityChanged();
  },

  setOwnerId: async (userId) => {
    await db.saveJSON("userOwner", userId);
    set({ ownerId: userId });
    await visibilityChanged();
  },

  replaceAliases: async (raw) => {
    const next: UserAliases = {};
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value === "string" && value.trim() && /^\d+$/.test(key)) next[key] = value.trim();
      }
    }
    await db.saveJSON("userAliases", next);
    set({ aliases: next });
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
    await visibilityChanged();
  },
}));
