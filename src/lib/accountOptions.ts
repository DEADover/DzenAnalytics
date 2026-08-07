/**
 * Список счетов для отбора в панели фильтров.
 *
 * Собирается из ДВУХ источников: счетов, встреченных в операциях, и справочника
 * счетов Дзен-мани. Только по операциям нельзя: счёт без единой операции в
 * загруженных данных — новый, пустой, закрытый или отсечённый разрезом — на
 * странице «Счета» есть, а в отборе не находился, и выглядело это как пропажа
 * (issue #67). Страница «Счета» ровно так же берёт объединение, и два списка
 * обязаны совпадать.
 *
 * В режиме CSV справочника нет вовсе — тогда остаются одни операции, и это
 * единственное, что там вообще известно.
 */

export interface AccountOptionsMeta {
  /** Названия архивных счетов — уходят вниз списка под свой разделитель. */
  archived: Set<string>;
  /** Название счёта → его вид («Карта», «Депозит», …). Пусто в режиме CSV. */
  kinds: Map<string, string>;
}

/**
 * Отсортированный список названий счетов.
 *
 * Порядок повторяет страницу «Счета»: активные перед архивными, внутри —
 * группами по виду счёта, внутри вида по алфавиту. Иначе один и тот же набор
 * счетов читался бы на двух экранах по-разному.
 */
export function accountOptions(
  txAccounts: Iterable<string | null | undefined>,
  known: Iterable<string>,
  meta: AccountOptionsMeta
): string[] {
  const set = new Set<string>();
  for (const a of txAccounts) if (a) set.add(a);
  for (const a of known) if (a) set.add(a);
  return Array.from(set).sort((a, b) => {
    const aa = meta.archived.has(a);
    const ba = meta.archived.has(b);
    if (aa !== ba) return aa ? 1 : -1;
    const ka = meta.kinds.get(a) ?? "";
    const kb = meta.kinds.get(b) ?? "";
    if (ka !== kb) return ka.localeCompare(kb, "ru");
    return a.localeCompare(b, "ru");
  });
}
