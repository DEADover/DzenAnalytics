import { useMemo } from "react";
import { useDataStore } from "../store/useDataStore";
import type { QueryValueLists } from "../lib/textQuery";
import type { Transaction } from "../types";

/**
 * Названия счетов и категорий для подстановки после «счёт:» и «кат:» в полях
 * поиска (`SyntaxInput`). Самые ходовые — первыми: при наборе «т» первым
 * должен предложиться счёт, которым платят каждый день, а не архивный.
 *
 * Полей поиска на странице два, а список один — считаем его раз на набор
 * операций, а не в каждом поле.
 */
const cache = new WeakMap<readonly Transaction[], QueryValueLists>();

function build(transactions: readonly Transaction[]): QueryValueLists {
  const accounts = new Map<string, number>();
  const categories = new Map<string, number>();
  const bump = (map: Map<string, number>, name: string | null | undefined) => {
    const n = (name ?? "").trim();
    if (n) map.set(n, (map.get(n) ?? 0) + 1);
  };
  for (const t of transactions) {
    bump(accounts, t.account);
    if (t.kind === "transfer") {
      bump(accounts, t.outcomeAccount);
      bump(accounts, t.incomeAccount);
    } else {
      // Категория и подкатегория — отдельными названиями: условие ищет слово
      // в любой из них, и «Кафе» находит «Еда / Кафе».
      bump(categories, t.category);
      bump(categories, t.subcategory);
      for (const extra of t.extraCategories ?? []) for (const part of extra.split(" / ")) bump(categories, part);
    }
  }
  const byUse = (map: Map<string, number>) =>
    [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru")).map(([name]) => name);
  return { account: byUse(accounts), category: byUse(categories) };
}

/** Списки для набора операций — из кэша, если этот набор уже считали. */
function listsFor(transactions: readonly Transaction[]): QueryValueLists {
  let lists = cache.get(transactions);
  if (!lists) {
    lists = build(transactions);
    cache.set(transactions, lists);
  }
  return lists;
}

export function useQueryValueLists(): QueryValueLists {
  const transactions = useDataStore((s) => s.transactions);
  return useMemo(() => listsFor(transactions), [transactions]);
}
