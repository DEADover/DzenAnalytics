/**
 * Люди на общем аккаунте Дзен-мани (issue #92).
 *
 * Дзен-мани помечает пользователем каждый объект: и операцию, и счёт, и план.
 * На личном аккаунте это поле бесполезно — оно везде одно и то же, — и мы его
 * при загрузке выбрасывали. На общем по одному токену приезжают данные всех
 * подключённых людей, и `user` оказывается единственным, чем они различаются.
 *
 * КАК ЗОВЁМ. Сам Дзен-мани знает про человека логин и почту. Почту не
 * показываем: это чужой адрес, и в списке фильтра ему не место. Остаётся логин,
 * а поверх него — псевдоним, который можно задать в настройках: в фильтре
 * «Жена» полезнее, чем «user4821».
 */

import type { ZenDiffResponse } from "./zenmoney";

/** Один человек на аккаунте — ровно то, что нужно списку и фильтру. */
export interface ZenUserOption {
  id: number;
  /** Логин из Дзен-мани; `null`, если сервис его не прислал. */
  login: string | null;
  /** Номер основного пользователя — у дополнительных на общем аккаунте. */
  parent: number | null;
}

/** Псевдонимы: номер пользователя (строкой, как ключ) → как его звать. */
export type UserAliases = Record<string, string>;

/**
 * Как показать пользователя.
 *
 * Порядок: псевдоним → логин → номер. Номер — последнее средство, но лучше
 * пустоты: по нему хотя бы видно, что людей несколько и они разные.
 */
export function userLabel(
  id: number,
  users: ZenUserOption[],
  aliases: UserAliases = {}
): string {
  const alias = aliases[String(id)]?.trim();
  if (alias) return alias;
  const login = users.find((u) => u.id === id)?.login?.trim();
  if (login) return login;
  return `Пользователь ${id}`;
}

/**
 * Разобрать запись `user` из ответа Дзен-мани.
 *
 * Тип поля в API — «объект с `id` и чем угодно ещё», поэтому логин достаём
 * осторожно: он строка, если есть, и `null` во всех прочих случаях.
 */
export function zenUsers(raw: ZenDiffResponse["user"] | undefined): ZenUserOption[] {
  if (!raw) return [];
  return raw.map((u) => ({
    id: u.id,
    login: typeof u.login === "string" && u.login.trim() ? u.login.trim() : null,
    parent: typeof u.parent === "number" ? u.parent : null,
  }));
}

/**
 * Кто реально встречается в данных, по убыванию числа операций.
 *
 * Берём не список аккаунта, а тех, чьи операции у нас есть: на общем аккаунте
 * человек мог не завести ни одной, и пустая строка в фильтре только мешает.
 * Порядок по частоте — чтобы тот, чьих операций больше, стоял первым; при
 * равенстве по номеру, чтобы список не прыгал между синхронизациями.
 */
export function usersInData(items: { user?: number }[]): number[] {
  const count = new Map<number, number>();
  for (const it of items) {
    if (it.user == null) continue;
    count.set(it.user, (count.get(it.user) ?? 0) + 1);
  }
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([id]) => id);
}

/**
 * Кто из списка — хозяин токена, то есть «я».
 *
 * ЭТО ДОГАДКА, и относиться к ней надо соответственно. Дзен-мани не помечает
 * владельца токена явно: приходит просто список людей аккаунта. У основного
 * пользователя `parent` пуст, у подключённых к нему — заполнен, и по этому
 * признаку почти всегда видно, кто главный. Почти — потому что проверить на
 * общем аккаунте мне было не на чем.
 *
 * Поэтому догадка не окончательна: её перебивает явный выбор в настройках
 * (`ownerOverride`). Там, где ошибка догадки видна человеку — в плановых
 * операциях, — у него есть чем её поправить.
 *
 * `null`, если список пуст.
 */
export function guessOwnerId(
  users: ZenUserOption[],
  ownerOverride?: number | null
): number | null {
  if (ownerOverride != null && users.some((u) => u.id === ownerOverride)) {
    return ownerOverride;
  }
  const root = users.find((u) => u.parent == null);
  return root?.id ?? users[0]?.id ?? null;
}
