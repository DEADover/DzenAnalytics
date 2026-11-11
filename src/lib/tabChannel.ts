/**
 * Вкладки одного аккаунта сообщают друг другу, что записали в хранилище.
 *
 * Каждое хранилище держит свои данные в памяти и пишет ключ целиком. Открой
 * панель в двух вкладках — и вторая, не зная о правке первой, при своей записи
 * затёрла бы её: в очереди правок осталась бы только своя. Поэтому запись
 * объявляется остальным вкладкам, и те перечитывают изменившееся (см.
 * `lib/crossTab`). Здесь только сам канал — без хранилищ, чтобы `lib/db` мог
 * звать его, не затягивая за собой полприложения.
 */
import { activeProfileId } from "./profiles";

/** Таблица операций — у неё нет своего ключа в `meta`. */
export const TRANSACTIONS_KEY = "#transactions";
/** Записано сразу многое (восстановление из бэкапа, полная очистка). */
export const EVERYTHING_KEY = "*";

interface WriteMessage {
  keys: string[];
}

let channel: BroadcastChannel | null | undefined;
function getChannel(): BroadcastChannel | null {
  if (channel === undefined) {
    // Только в браузере: в тестах и при сборке канала нет и быть не должно.
    channel =
      typeof window === "undefined" || typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel(`dzenanalytics-data:${activeProfileId()}`);
  }
  return channel;
}

const pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

/** Объявить запись ключа. Соседние записи уходят одним сообщением. */
export function announceWrite(key: string): void {
  if (!getChannel()) return;
  pending.add(key);
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const keys = [...pending];
    pending.clear();
    try {
      getChannel()?.postMessage({ keys } satisfies WriteMessage);
    } catch {
      /* канал закрыт — сообщать некому */
    }
  }, 100);
}

/** Слушать записи ДРУГИХ вкладок. Свои сюда не приходят. */
export function onForeignWrite(listener: (keys: string[]) => void): () => void {
  const ch = getChannel();
  if (!ch) return () => {};
  const handler = (e: MessageEvent<WriteMessage>) => {
    const keys = e.data?.keys;
    if (Array.isArray(keys) && keys.length > 0) listener(keys);
  };
  ch.addEventListener("message", handler);
  return () => ch.removeEventListener("message", handler);
}
