/**
 * Дерево категорий для поля выбора — «родитель → подкатегории».
 *
 * Жило внутри окна правки операции, пока не понадобилось окну разделения
 * (issue #69). Две копии такой сборки неминуемо разошлись бы в мелочах, а
 * мелочи здесь дорогие: половина логики — про то, какие категории ВЫБИРАТЬ
 * НЕЛЬЗЯ, потому что отправка их всё равно не примет.
 */

import type { CategoryNode } from "../components/CategoryCascadePicker";
import type { ZenTag } from "./zenmoney";
import { NO_CATEGORY } from "./zenmoneyMap";

export function buildCategoryNodes(
  /** Плоский список названий категорий, встреченных в данных. */
  categoryOptions: string[],
  /** Подкатегории, встреченные в истории операций. */
  subcatByCategory: Map<string, Set<string>>,
  /** Живой справочник тегов Дзен-мани. `null` — режим CSV. */
  cacheTags: ZenTag[] | null
): CategoryNode[] {
  const subsMap = new Map<string, Set<string>>();
  const addSub = (cat: string, sub: string) => {
    let s = subsMap.get(cat);
    if (!s) {
      s = new Set<string>();
      subsMap.set(cat, s);
    }
    s.add(sub);
  };
  // Подкатегории из ИСТОРИИ операций — только когда живого справочника нет
  // (выгрузка CSV). При синхронизации с Дзен-мани справочник и есть правда:
  // в истории остаются имена подкатегорий, которых в Дзен-мани уже нет —
  // удалённых, убранных в архив или переехавших к другому родителю. Выбрать
  // такую было можно, а сохранить нельзя: отправка ищет тег по живому
  // справочнику и отвечала «категория не найдена».
  if (!cacheTags) {
    for (const [cat, subs] of subcatByCategory)
      for (const sub of subs) addSub(cat, sub);
  }
  const realTop = new Set<string>();
  if (cacheTags) {
    const byId = new Map(cacheTags.map((t) => [t.id, t] as const));
    for (const t of cacheTags) {
      if (t.archive) continue;
      if (t.parent) {
        const parent = byId.get(t.parent);
        if (parent && !parent.archive) addSub(parent.title, t.title);
      } else {
        realTop.add(t.title);
      }
    }
  }
  // Names that are a child of some category — drop them from the first level
  // unless they're *also* a genuine top-level tag (e.g. a "Прочее" that exists
  // both as its own category and as a sub elsewhere).
  const childNames = new Set<string>();
  for (const subs of subsMap.values()) for (const s of subs) childNames.add(s);
  // Живые названия тегов: с ними сверяется отправка. Категории, которой в
  // справочнике уже нет, в списке быть не должно — сохранить операцию с ней
  // всё равно не выйдет.
  const liveTitles = cacheTags
    ? new Set(cacheTags.filter((t) => !t.archive).map((t) => t.title))
    : null;
  const tops = categoryOptions.filter(
    // Drop full-path «Parent / Sub» entries — categoryMeta carries those keys
    // (for same-named-sub icons), but the first level is top-level only; subs
    // are reached via the right panel.
    (c) =>
      !c.includes(" / ") &&
      (realTop.has(c) || !childNames.has(c)) &&
      (!liveTitles || liveTitles.has(c))
  );
  // Always offer «Без категории» (pinned first) so a category can be REMOVED —
  // Zenmoney has no uncategorized tag, so this maps to a tag-less operation on
  // push. Without this the option only appeared when uncategorized data existed.
  const withClear = [NO_CATEGORY, ...tops.filter((c) => c !== NO_CATEGORY)];
  return withClear.map((name) => ({
    name,
    subs: Array.from(subsMap.get(name) ?? []).sort((a, b) =>
      a.localeCompare(b, "ru")
    ),
  }));
}
