/**
 * Строки таблицы категорий и строка «Без подкатегории» — отдельно от самого
 * компонента: файл с компонентом должен отдавать только компоненты, иначе
 * горячая перезагрузка в разработке перезапускает всю страницу.
 */

export interface CategoryTableRow {
  key: string;
  name: string;
  /** Родитель подкатегории — для значка и подсказки. */
  parent?: string;
  value: number;
  count: number;
  /** Доля от итога таблицы, 0…1. */
  share: number;
  /** С чем сравниваем: среднее за прошлые месяцы или второй период. */
  compare?: number;
  /** Цвет полосы. */
  color?: string;
  /** Цвет значка, если у подкатегории своего нет. */
  dotFallback?: string;
  /** «Без подкатегории»: операции самой категории, не разнесённые по подкатегориям. */
  own?: boolean;
  children?: CategoryTableRow[];
}

/** Подпись строки с операциями самой категории, без подкатегории. */
export const OWN_ROW_LABEL = "Без подкатегории";

/**
 * Строка «Без подкатегории» под категорией — та часть суммы, что записана на
 * саму категорию. Без неё подкатегории не складывались в итог категории, и
 * разница ничем не объяснялась. Нужна, только если у категории есть
 * подкатегории (`hasSubs`) и на ней самой что-то есть.
 */
export function ownCategoryRow(
  parent: string,
  hasSubs: boolean,
  row: Omit<CategoryTableRow, "key" | "name" | "parent" | "own">
): CategoryTableRow[] {
  if (!hasSubs || (row.value <= 0.0001 && (row.compare ?? 0) <= 0.0001)) return [];
  return [{ ...row, key: `${parent}::own`, name: OWN_ROW_LABEL, parent, own: true }];
}
