/**
 * Теги операции и её категории (#69).
 *
 * У операции в Дзен-мани может быть несколько категорий: первая — основная,
 * остальные многие используют вместо тегов («Отпуск», «Ремонт»). А кто-то
 * помечает операции хэштегами в комментарии. Сервис умеет оба способа, и
 * какой из них считать тегами, человек выбирает сам — это `TagMode`.
 *
 * Здесь только чистые функции: откуда брать теги и какие категории есть у
 * операции. Суммы по категориям они не трогают — там операция по-прежнему
 * считается один раз, по основной.
 */

import { extractHashtags } from "./aggregations";
import type { Transaction } from "../types";

/**
 * Что считать тегами операции.
 *
 *   • `hashtags`   — слова с решёткой в комментарии: «Ужин #отпуск»;
 *   • `categories` — вторая и следующие категории операции.
 */
export type TagMode = "hashtags" | "categories";

export const DEFAULT_TAG_MODE: TagMode = "hashtags";

/** Все категории операции: основная первой, дальше — вторые. */
export function categoryKeysOf(
  t: Pick<Transaction, "categoryFull" | "extraCategories">
): string[] {
  const extra = t.extraCategories;
  return extra && extra.length > 0 ? [t.categoryFull, ...extra] : [t.categoryFull];
}

/**
 * Есть ли у операции эта категория — основной или второй.
 *
 * Так фильтрует и мобильное приложение Дзен-мани: операция с основной «Еда»
 * и второй «Отпуск» находится по обеим. Сравнение строгое, по полному
 * названию: подкатегория «Еда / Кафе» не тянет за собой родителя.
 */
export function hasCategory(
  t: Pick<Transaction, "categoryFull" | "extraCategories">,
  key: string
): boolean {
  return t.categoryFull === key || (t.extraCategories?.includes(key) ?? false);
}

/** Теги операции в выбранном режиме. Без повторов, в порядке появления. */
export function tagsOf(
  t: Pick<Transaction, "comment" | "extraCategories">,
  mode: TagMode
): string[] {
  if (mode === "categories") return t.extraCategories ? [...t.extraCategories] : [];
  return extractHashtags(t.comment);
}

/**
 * Как тег выглядит в интерфейсе.
 *
 * Хэштег пишется с решёткой — так его набирают в комментарии и так узнают. У
 * категории решётки нет: это название из справочника, и «#Путешествия /
 * Отпуск» читалось бы как опечатка.
 */
export function tagLabel(tag: string, mode: TagMode): string {
  return mode === "hashtags" ? `#${tag}` : tag;
}
