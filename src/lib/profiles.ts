/**
 * Несколько аккаунтов на одном устройстве — у каждого своя база в браузере.
 *
 * Всё, что относится к аккаунту, живёт в одной базе IndexedDB: операции,
 * кэш и токен Дзен-мани, правки, правила, настройки. Поэтому аккаунт — это
 * просто имя базы. Основной аккаунт держит прежнее имя `dzenanalytics`: у
 * тех, кто заводит второй аккаунт, данные никуда не переезжают.
 *
 * Список аккаунтов и выбранный — в localStorage: это знание устройства, а не
 * одного аккаунта, и прочитать его надо до того, как открыта какая-то база.
 *
 * Переключение — перезагрузка страницы на базе другого аккаунта. Так ни один
 * экран, ни один кэш в памяти не покажет остаток чужих данных, а на локальной
 * базе это занимает секунду.
 */

export interface Profile {
  id: string;
  /** Своё название. Пустое — подписываем логином Дзен-мани. */
  name: string;
  /** Логин Дзен-мани, запомненный при последнем входе в этот аккаунт. */
  login?: string | null;
  /** Фото — маленький квадрат data-URL (`lib/avatarImage`). Нет — буква на цвете. */
  avatar?: string | null;
  createdAt: string;
}

export const DEFAULT_PROFILE_ID = "default";
const BASE_DB_NAME = "dzenanalytics";
const LIST_KEY = "dzenanalytics:profiles";
const ACTIVE_KEY = "dzenanalytics:activeProfile";

type KV = Pick<Storage, "getItem" | "setItem">;

function storage(): KV | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

const defaultProfile = (): Profile => ({
  id: DEFAULT_PROFILE_ID,
  name: "Основной",
  createdAt: "",
});

/** Имя базы IndexedDB аккаунта. */
export function dbNameFor(id: string): string {
  return id === DEFAULT_PROFILE_ID ? BASE_DB_NAME : `${BASE_DB_NAME}-${id}`;
}

/** Подпись аккаунта в списках: своё название, иначе логин. */
export function profileLabel(p: Pick<Profile, "name" | "login">): string {
  return p.name.trim() || p.login?.trim() || "Без названия";
}

function isProfile(v: unknown): v is Profile {
  const p = v as Profile;
  return !!p && typeof p.id === "string" && !!p.id && typeof p.name === "string";
}

/** Все аккаунты. Пусто или испорчено — один основной. */
export function readProfiles(kv: KV | null = storage()): Profile[] {
  try {
    const raw = kv?.getItem(LIST_KEY);
    const list = raw ? (JSON.parse(raw) as unknown[]).filter(isProfile) : [];
    return list.length > 0 ? list : [defaultProfile()];
  } catch {
    return [defaultProfile()];
  }
}

function writeProfiles(list: Profile[], kv: KV | null): boolean {
  let ok = true;
  try {
    kv?.setItem(LIST_KEY, JSON.stringify(list));
  } catch {
    ok = false;
    // Хранилище недоступно или переполнено — список живёт до перезагрузки.
  }
  notify();
  return ok;
}

/** Выбранный аккаунт. Неизвестный id — первый из списка. */
export function activeProfileId(kv: KV | null = storage()): string {
  const list = readProfiles(kv);
  let id: string | null = null;
  try {
    id = kv?.getItem(ACTIVE_KEY) ?? null;
  } catch {
    id = null;
  }
  return id && list.some((p) => p.id === id) ? id : list[0].id;
}

export function setActiveProfileId(id: string, kv: KV | null = storage()): void {
  try {
    kv?.setItem(ACTIVE_KEY, id);
  } catch {
    // ignore
  }
  notify();
}

/** Новый аккаунт. Выбранным он не становится — это делает переключение. */
export function addProfile(name: string, kv: KV | null = storage()): Profile {
  const list = readProfiles(kv);
  const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const profile: Profile = { id, name: name.trim(), createdAt: new Date().toISOString() };
  writeProfiles([...list, profile], kv);
  return profile;
}

export function renameProfile(id: string, name: string, kv: KV | null = storage()): void {
  writeProfiles(
    readProfiles(kv).map((p) => (p.id === id ? { ...p, name: name.trim() } : p)),
    kv
  );
}

/**
 * Поставить или убрать фото аккаунта. `false` — хранилище не приняло (место в
 * localStorage кончилось): вызывающий скажет об этом, а не сделает вид, что
 * фото сохранилось.
 */
export function setProfileAvatar(id: string, avatar: string | null, kv: KV | null = storage()): boolean {
  const list = readProfiles(kv);
  if (!list.some((p) => p.id === id)) return false;
  const next = list.map((p) => {
    if (p.id !== id) return p;
    const { avatar: _old, ...rest } = p;
    void _old;
    return avatar ? { ...rest, avatar } : rest;
  });
  return writeProfiles(next, kv);
}

/** Запомнить логин Дзен-мани — только если он изменился. */
export function setProfileLogin(id: string, login: string | null, kv: KV | null = storage()): void {
  const list = readProfiles(kv);
  const cur = list.find((p) => p.id === id);
  if (!cur || (cur.login ?? null) === login) return;
  writeProfiles(list.map((p) => (p.id === id ? { ...p, login } : p)), kv);
}

/**
 * Убрать аккаунт из списка. Выбранный убрать нельзя — сначала переключиться:
 * иначе страница осталась бы на базе, которой уже нет в списке. Саму базу
 * удаляет вызывающий (`indexedDB.deleteDatabase`).
 */
export function removeProfile(id: string, kv: KV | null = storage()): boolean {
  if (id === activeProfileId(kv)) return false;
  const list = readProfiles(kv);
  if (!list.some((p) => p.id === id)) return false;
  writeProfiles(list.filter((p) => p.id !== id), kv);
  return true;
}

// Подписка для React: список меняется и в этой вкладке, и в соседних.
const listeners = new Set<() => void>();
function notify() {
  for (const l of listeners) l();
}
export function subscribeProfiles(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === LIST_KEY || e.key === ACTIVE_KEY) listener();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}
