import { useEffect, useState } from "react";
import type { Transaction } from "../types";
import type { CategoryNode } from "../components/CategoryFilterPicker";
import { getZenCache } from "../lib/zenCacheMemo";
import { categoryNodesOf, tagKindsOf, type TagKinds } from "../lib/categoryFilterNodes";

/** Последний разобранный справочник: новый экран берёт его сразу. */
let lastTagKinds: TagKinds = new Map();

/**
 * Категории для отбора по нескольким сразу — общие фильтры и настройки
 * «Ориентиров». Тип категории (расходная, доходная) берётся из справочника
 * Дзен-мани; без него (CSV) выводится из самих операций.
 */
export function useCategoryFilterNodes(transactions: Transaction[]): CategoryNode[] {
  // Тот же объект, пока справочник не менялся (см. `tagKindsOf`): новый на
  // каждый переход пересобирал бы дерево категорий второй раз.
  const [tagKinds, setTagKinds] = useState<TagKinds>(() => lastTagKinds);
  useEffect(() => {
    let cancelled = false;
    void getZenCache().then((cache) => {
      if (cancelled || !cache) return;
      lastTagKinds = tagKindsOf(cache.tags);
      setTagKinds(lastTagKinds);
    });
    return () => {
      cancelled = true;
    };
  }, [transactions]);
  return categoryNodesOf(transactions, tagKinds);
}
