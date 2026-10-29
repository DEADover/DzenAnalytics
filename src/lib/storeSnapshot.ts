/**
 * Снимок хранилищ на диске — для «Отменить» после массовых действий.
 *
 * Откат всех неотправленных изменений, отмена импорта, объединение сотни
 * контрагентов задевают сразу несколько хранилищ, и вернуть их по одной записи
 * было бы долго и хрупко. Снимок берёт их значения с диска (копиями — IndexedDB
 * отдаёт копию, не ссылку), а отмена кладёт значения обратно и просит каждое
 * хранилище перечитать себя: у всех них есть `hydrate`, который читает ровно
 * этот ключ.
 *
 * Отмена возвращает хранилища ЦЕЛИКОМ — вместе с тем, что успели поменять за
 * секунды, пока висела плашка. Поэтому для удаления одного элемента списка
 * лучше вернуть сам элемент (`reinsert`), а снимок — для действий, которые и
 * так трогают всё.
 */
import * as db from "./db";

interface Hydratable {
  getState: () => { hydrate: () => Promise<void> };
}

/** Хранилище и ключи, под которыми оно лежит на диске. */
export type StoreSlot = readonly [store: Hydratable, keys: readonly string[]];

export async function snapshotStores(slots: readonly StoreSlot[]): Promise<() => Promise<void>> {
  const saved = await Promise.all(
    slots.map(([, keys]) => Promise.all(keys.map((k) => db.loadJSON<unknown>(k))))
  );
  return async () => {
    for (let i = 0; i < slots.length; i++) {
      const [store, keys] = slots[i];
      for (let j = 0; j < keys.length; j++) await db.saveJSON(keys[j], saved[i][j]);
      await store.getState().hydrate();
    }
  };
}

/**
 * Вернуть удалённый элемент на прежнее место — в ТЕКУЩИЙ список, а не в
 * старый снимок: правки соседей, сделанные после удаления, остаются.
 */
export function reinsert<T extends { id: string }>(list: readonly T[], item: T, index: number): T[] {
  const rest = list.filter((x) => x.id !== item.id);
  const at = Math.max(0, Math.min(index, rest.length));
  return [...rest.slice(0, at), item, ...rest.slice(at)];
}
