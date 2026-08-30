/**
 * Дерево категорий для поля выбора — готовое к употреблению.
 *
 * Собрать его непросто: список категорий берётся из справочника Дзен-мани по
 * признаку «показывать в расходах / в доходах», подкатегории — из истории
 * операций, а иерархия родитель→ребёнок живёт только в сырых тегах, которые
 * приходится дочитывать из кэша. Всё это было расписано внутри окна правки
 * операции, и окну разделения (issue #69) понадобилось ровно то же самое.
 */

import { useEffect, useMemo, useState } from "react";
import type { CategoryNode } from "../components/CategoryCascadePicker";
import { buildCategoryNodes } from "../lib/categoryNodes";
import { loadZenCache } from "../lib/zenmoneyCache";
import type { ZenTag } from "../lib/zenmoney";
import { useDataStore } from "../store/useDataStore";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";

/** `kind` задаёт, какие категории предлагать: расходные или доходные. */
export function useCategoryNodes(kind: string): CategoryNode[] {
  const allTransactions = useDataStore((s) => s.transactions);
  const categoryMeta = useCategoryMetaStore((s) => s.meta);

  // Сырые теги Дзен-мани — единственное место, где лежит настоящая иерархия
  // родитель→ребёнок (`categoryMeta` ключуется по названию и её схлопывает).
  const [cacheTags, setCacheTags] = useState<ZenTag[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadZenCache().then((c) => {
      if (!cancelled) setCacheTags(c?.tags ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const { categoryOptions, subcatByCategory } = useMemo(() => {
    const subByCat = new Map<string, Set<string>>();
    for (const t of allTransactions) {
      if (!t.category || !t.subcategory) continue;
      let bucket = subByCat.get(t.category);
      if (!bucket) {
        bucket = new Set<string>();
        subByCat.set(t.category, bucket);
      }
      bucket.add(t.subcategory);
    }

    // 1) Категории с признаком из Дзен-мани — «показывать в расходах» или
    //    «в доходах». Это ответ самого справочника, ему и верим.
    const metaKeys = Object.keys(categoryMeta);
    const hasFlags = metaKeys.some(
      (k) =>
        categoryMeta[k]?.showIncome !== undefined ||
        categoryMeta[k]?.showOutcome !== undefined
    );
    if (hasFlags && kind !== "transfer") {
      const flagField = kind === "income" ? "showIncome" : "showOutcome";
      const cats = metaKeys.filter((name) => categoryMeta[name]?.[flagField]);
      return {
        categoryOptions: cats.sort((a, b) => a.localeCompare(b, "ru")),
        subcatByCategory: subByCat,
      };
    }

    // 2) Признаков нет (выгрузка CSV) — выводим из самих операций этого вида.
    const cats = new Set<string>();
    for (const t of allTransactions) {
      if (kind !== "transfer" && t.kind !== kind) continue;
      if (!t.category) continue;
      cats.add(t.category);
    }
    return {
      categoryOptions: Array.from(cats).sort((a, b) => a.localeCompare(b, "ru")),
      subcatByCategory: subByCat,
    };
  }, [allTransactions, kind, categoryMeta]);

  return useMemo(
    () => buildCategoryNodes(categoryOptions, subcatByCategory, cacheTags),
    [categoryOptions, subcatByCategory, cacheTags]
  );
}
