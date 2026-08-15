import type { ZenTag } from "./zenmoney";

/**
 * Дерево категорий по ЖИВОМУ справочнику Дзен-мани.
 *
 * Списки, из которых человек выбирает категорию для записи (правка операции,
 * действие правила), обязаны совпадать с тем, что примет отправка: она ищет тег
 * по справочнику и архивные пропускает. Пока список собирался из истории
 * операций, выбрать можно было и то, чего в справочнике уже нет — удалённое,
 * убранное в архив или переехавшее к другому родителю, — а сохранение падало с
 * «Категория не найдена в Дзен-мани».
 *
 * Для УСЛОВИЙ правил это правило не годится: там как раз нужны имена из
 * истории, иначе не поймать операции со старой категорией.
 */
export interface CategoryTreeNode {
  name: string;
  subs: string[];
}

export function liveCategoryNodes(tags: ZenTag[]): CategoryTreeNode[] {
  const live = tags.filter((t) => !t.archive);
  const byId = new Map(live.map((t) => [t.id, t] as const));
  const subs = new Map<string, Set<string>>();
  const tops = new Set<string>();

  for (const t of live) {
    const parent = t.parent ? byId.get(t.parent) : undefined;
    if (parent) {
      const bucket = subs.get(parent.title) ?? new Set<string>();
      bucket.add(t.title);
      subs.set(parent.title, bucket);
    } else {
      // Сюда же попадает «сирота» — тег, чей родитель в архиве. Отправка такую
      // категорию найдёт (поиск без подкатегории идёт по имени), значит и
      // предлагать её надо, а не терять вместе с родителем.
      tops.add(t.title);
    }
  }

  return [...tops]
    .sort((a, b) => a.localeCompare(b, "ru"))
    .map((name) => ({
      name,
      subs: [...(subs.get(name) ?? [])].sort((a, b) => a.localeCompare(b, "ru")),
    }));
}
