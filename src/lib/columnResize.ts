/**
 * Своя ширина столбцов — расчёты без DOM и React.
 *
 * Модель как в таблицах Excel: тянешь правый край колонки — меняется только
 * она, остальные сохраняют ширину и просто сдвигаются. Таблица при этом
 * становится шире (появляется прокрутка вбок) или уже карточки.
 *
 * Прежде разницу забирала «резиновая» колонка (название, комментарий), чтобы
 * таблица оставалась во всю ширину. Но резиновая часто стояла рядом, и
 * пользователь видел, что вместе с одной колонкой меняется соседняя, а у
 * колонок правее резиновой граница вообще двигала соседа справа (30.09.2026:
 * «хочется, чтобы изменение размера столбца не меняло размеры рядом стоящего»).
 *
 * Ширины хранятся в `rem` при обычном размере текста таблиц — так они растут
 * вместе с настройкой «Размер текста в таблицах», как и ширины по умолчанию.
 */

/** Сохранённые ширины одной таблицы: ключ колонки → `rem` при тексте 14 px. */
export type ColumnWidthMap = Record<string, number>;

/** Новая ширина колонки при сдвиге её правого края на `delta` пикселей: не уже подписи. */
export function clampWidth(start: number, delta: number, min: number): number {
  return Math.max(start + delta, min);
}

/** Пиксели в `rem` при обычном размере текста таблиц, с точностью до сотой. */
export function pxToRem(px: number, remPx: number, scale: number): number {
  const unit = remPx * (scale > 0 ? scale : 1);
  return Math.round((px / unit) * 100) / 100;
}

/** CSS-ширина из сохранённых `rem`: растёт с размером текста таблиц. */
export function remWidth(rem: number): string {
  return `calc(${rem}rem * var(--tbl-scale, 1))`;
}

/**
 * Годятся ли сохранённые ширины: хотя бы одна колонка из них есть в таблице.
 * После переделки колонок старые ширины просто не применяются.
 */
export function hasWidthsFor(map: ColumnWidthMap | undefined, keys: readonly string[]): boolean {
  if (!map) return false;
  return keys.some((k) => typeof map[k] === "number" && map[k] > 0);
}

function stored(map: ColumnWidthMap | undefined, key: string): number | undefined {
  const v = map?.[key];
  return typeof v === "number" && v > 0 ? v : undefined;
}

/**
 * Ширина всей таблицы — сумма колонок. Своя ширина — из `map`, у остальных —
 * ширина по умолчанию (`fallback`, уже CSS). `extra` — колонки вне списка
 * (чекбокс выбора). Если хоть у одной колонки ширины нет, сумму не сложить:
 * `null`, и таблица остаётся во всю ширину.
 */
export function tableWidthOf(
  cols: readonly { key: string; fallback?: string }[],
  map: ColumnWidthMap | undefined,
  extra: readonly string[] = []
): string | null {
  let rem = 0;
  const parts: string[] = [...extra];
  for (const c of cols) {
    const own = stored(map, c.key);
    if (own) rem += own;
    else if (c.fallback) parts.push(c.fallback);
    else return null;
  }
  const remPart = rem > 0 ? [`${Math.round(rem * 100) / 100}rem * var(--tbl-scale, 1)`] : [];
  const all = [...remPart, ...parts];
  if (all.length === 0) return null;
  return `calc(${all.join(" + ")})`;
}

/** Сетка ленты с учётом своих ширин: у колонки со своей шириной — она, у прочих — дорожка по умолчанию. */
export function gridTemplateWith(
  tracks: readonly { key: string; size: string }[],
  map: ColumnWidthMap | undefined
): string {
  return tracks
    .map((t) => {
      const own = stored(map, t.key);
      return own ? remWidth(own) : t.size;
    })
    .join(" ");
}

/** Имя CSS-переменной для живой сетки во время перетаскивания. */
export function liveVarName(id: string): string {
  return `--cols-${id.replace(/[^a-zA-Z0-9_-]+/g, "_")}`;
}
