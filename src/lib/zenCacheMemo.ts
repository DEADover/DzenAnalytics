/**
 * Кэш Дзен-мани, прочитанный один раз на весь экран.
 *
 * Кэш лежит в IndexedDB, и чтение асинхронное. Пока каждый виджет читал его
 * сам, главная успевала перерисоваться дважды: сначала без разбора, потом с
 * ним, — и списки на глазах пересобирались. Здесь чтение одно на всех:
 * готовый ответ отдаётся синхронно из памяти, а после записи кэша
 * перечитывается и подменяется целиком.
 *
 * Тот же приём, что у разбора счетов в `useZenmoneyStore`, но общий: сюда
 * ходят все, кому нужен сырой кэш, — планы Дзен-мани и всё, что появится
 * дальше.
 */

import { loadZenCache, type ZenCache } from "./zenmoneyCache";

let memo: ZenCache | null | undefined;
let stale = false;
let inFlight: Promise<ZenCache | null> | null = null;
const listeners = new Set<() => void>();

/** Готовый кэш без ожидания. `undefined` — ещё не читали. */
export function peekZenCache(): ZenCache | null | undefined {
  return memo;
}

/** Подписка на смену кэша — под `useSyncExternalStore`. */
export function subscribeZenCache(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Кэш переписан — прочитанное устарело.
 *
 * Прежний ответ при этом НЕ выбрасываем, а перечитываем и подменяем готовым:
 * обнулять значило бы оставить экран без данных на пару кадров сразу после
 * синхронизации.
 */
export function invalidateZenCache(): void {
  stale = true;
  inFlight = null;
  if (memo !== undefined) void getZenCache();
}

export function getZenCache(): Promise<ZenCache | null> {
  if (memo !== undefined && !stale) return Promise.resolve(memo);
  inFlight ??= loadZenCache().then(
    (data) => {
      memo = data ?? null;
      stale = false;
      inFlight = null;
      for (const listener of listeners) listener();
      return memo;
    },
    () => {
      inFlight = null;
      return null;
    }
  );
  return inFlight;
}
