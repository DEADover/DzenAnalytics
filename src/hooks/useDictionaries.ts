// Справочники Дзен-мани для тех, кто их не показывает, а на них ссылается:
// счётчики на вкладках настроек и список названий контрагентов для фильтров.
//
// Считается ЗДЕСЬ, а не в самих справочниках: числа нужны на обеих вкладках
// сразу (неактивная не смонтирована и посчитать себя не может), а названия
// контрагентов нужны страницам, где справочника нет вовсе. Источник тот же, из
// которого справочники строят свои списки, — кэш Дзен-мани плюс ещё не
// отправленные черновики, поэтому числа совпадают с длиной списка внутри.

import { useEffect, useMemo, useState } from "react";
import { loadZenCache } from "../lib/zenmoneyCache";
import { useZenmoneyStore } from "../store/useZenmoneyStore";
import { useNewCategoriesStore } from "../store/useNewCategoriesStore";
import { useCounterpartyEditsStore } from "../store/useCounterpartyEditsStore";

export interface DictionaryCounts {
  /** Категорий в справочнике; `null` — кэша нет (режим CSV или до синка). */
  categories: number | null;
  /** Контрагентов в справочнике; `null` — кэша нет. */
  counterparties: number | null;
}

export function useDictionaryCounts(): DictionaryCounts {
  // Пересчитываем после синхронизации — справочник мог приехать другим.
  const serverTimestamp = useZenmoneyStore((s) => s.serverTimestamp);
  const newCats = useNewCategoriesStore((s) => s.items);
  const created = useCounterpartyEditsStore((s) => s.created);
  const [cached, setCached] = useState<{ tags: number; merchants: number } | null>(
    null
  );

  useEffect(() => {
    let alive = true;
    void loadZenCache().then((cache) => {
      if (!alive) return;
      setCached(
        cache ? { tags: cache.tags.length, merchants: cache.merchants.length } : null
      );
    });
    return () => {
      alive = false;
    };
  }, [serverTimestamp]);

  if (!cached) return { categories: null, counterparties: null };
  return {
    categories: cached.tags + newCats.length,
    counterparties: cached.merchants + created.length,
  };
}

/**
 * Названия контрагентов из справочника — чтобы страницы могли отличить
 * получателя, заведённого в Дзен-мани, от строки, которую прислал банк.
 *
 * В операции лежит НАЗВАНИЕ контрагента (`brand`), а не его id, поэтому и
 * сверяемся по названию — так же, как это делает отправка в облако.
 * Пустое множество означает «справочника нет» (режим CSV или до первой
 * синхронизации): тогда делить получателей не на что.
 */
export function useCounterpartyTitles(): Set<string> {
  const serverTimestamp = useZenmoneyStore((s) => s.serverTimestamp);
  const created = useCounterpartyEditsStore((s) => s.created);
  const renames = useCounterpartyEditsStore((s) => s.renames);
  const [titles, setTitles] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let alive = true;
    void loadZenCache().then((cache) => {
      if (!alive) return;
      setTitles(new Map((cache?.merchants ?? []).map((m) => [m.id, m.title])));
    });
    return () => {
      alive = false;
    };
  }, [serverTimestamp]);

  return useMemo(() => {
    const out = new Set<string>();
    // Переименование ещё не уехало в облако, но в справочнике человек видит уже
    // новое имя — иначе только что переименованный контрагент выпал бы из
    // «своих» на других экранах.
    for (const [id, title] of titles) out.add(renames[id] ?? title);
    for (const c of created) out.add(c.title);
    return out;
  }, [titles, renames, created]);
}
