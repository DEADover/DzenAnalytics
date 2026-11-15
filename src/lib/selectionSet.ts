import { FILTER_NONE } from "../store/useFiltersStore";

/**
 * Сохранённый список ↔ выбор в `MultiSelect` и `CategoryFilterPicker`.
 *
 * У списков выбора соглашение фильтров: пусто = все, {FILTER_NONE} = ничего.
 * У настроек наоборот: пустой список — «ничего не выбрано», а «все» — это
 * просто все пункты поимённо (источники цели, категории ориентира).
 */
export function listToSet(list: readonly string[], all: readonly string[]): Set<string> {
  const known = list.filter((t) => all.includes(t));
  if (known.length === 0) return new Set([FILTER_NONE]);
  if (known.length >= all.length) return new Set();
  return new Set(known);
}

export function setToList(next: ReadonlySet<string>, all: readonly string[]): string[] {
  if (next.has(FILTER_NONE)) return [];
  if (next.size === 0) return [...all];
  return all.filter((t) => next.has(t));
}
