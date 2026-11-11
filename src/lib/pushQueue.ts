/**
 * Очереди правок и отправка: что снимать с очереди после ответа облака.
 *
 * Отправка идёт секунду-другую, и всё это время человек продолжает работать.
 * Запрос собран из снимка очереди на момент старта; если после ответа снимать
 * записи просто по id, пропадёт то, что успели поправить по ходу: правка легла
 * в ту же запись, в облако не уехала, а с очереди ушла.
 *
 * Поэтому после ответа сравниваем запись с тем, что уезжало: совпала — снимаем,
 * изменилась — остаётся и уйдёт следующей отправкой. Сравнение по содержимому,
 * а не по ссылке: очередь могли перечитать с диска, и ссылки тогда другие.
 */

/** Одно и то же содержимое. */
export function sameEntry(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Какие из отправленных записей можно снять с очереди: те, что с момента
 * снимка не менялись (или которых в очереди уже нет).
 */
export function unchangedSince<T>(
  ids: readonly string[],
  sent: Readonly<Record<string, T>>,
  now: Readonly<Record<string, T>>
): string[] {
  return ids.filter((id) => !(id in now) || sameEntry(sent[id], now[id]));
}

/** Поля записи, которые появились или изменились после снимка. */
export function changedFields<T extends object>(sent: T | undefined, now: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(now) as (keyof T)[]) {
    if (!sameEntry(sent?.[key], now[key])) out[key] = now[key];
  }
  return out;
}
