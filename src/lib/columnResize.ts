/**
 * Своя ширина столбцов — расчёты без DOM и React.
 *
 * Модель одна на все таблицы и ленты. У таблицы есть одна «резиновая» колонка
 * (обычно название или комментарий): она занимает всё, что осталось, и
 * таблица всегда во всю ширину карточки. Остальные колонки, стоит потянуть
 * любую границу, получают свои ширины в `rem` при обычном размере текста —
 * так они растут вместе с настройкой «Размер текста в таблицах», как и
 * ширины по умолчанию (`scaledWidth`).
 *
 * Граница под мышью всегда идёт за мышью. Левее резиновой колонки граница
 * меняет колонку слева от себя, правее — колонку справа: резиновая забирает
 * или отдаёт разницу.
 */

/** Сохранённые ширины одной таблицы: ключ колонки → `rem` при тексте 14 px. */
export type ColumnWidthMap = Record<string, number>;

export interface FlexCandidate {
  key: string;
  type?: string;
  width?: string;
  resizable?: boolean;
}

/**
 * Какая колонка резиновая. По порядку: та, что и так забирает всю ширину
 * (`100%`), первая текстовая без ширины, любая без ширины, первая текстовая,
 * первая.
 */
export function pickFlexIndex(cols: readonly FlexCandidate[]): number {
  const find = (fn: (c: FlexCandidate) => boolean) => cols.findIndex(fn);
  const noWidth = (c: FlexCandidate) => !c.width || c.width === "auto";
  const candidates = [
    find((c) => c.width === "100%"),
    find((c) => c.type === "text" && noWidth(c)),
    find((c) => noWidth(c) && c.type !== "actions"),
    find((c) => c.type === "text"),
  ];
  const hit = candidates.find((i) => i >= 0);
  return hit ?? 0;
}

/**
 * Какую колонку меняет граница `border` (между колонками `border` и
 * `border + 1`) и в какую сторону: `+1` — колонка растёт, когда граница идёт
 * вправо.
 */
export function resizeTarget(
  border: number,
  flex: number
): { index: number; sign: 1 | -1 } {
  return border < flex ? { index: border, sign: 1 } : { index: border + 1, sign: -1 };
}

/**
 * Новая ширина колонки при сдвиге границы на `delta` пикселей. Не уже
 * подписи шапки и не больше, чем может отдать резиновая колонка, не став уже
 * своей подписи.
 */
export function nextWidth(opts: {
  start: number;
  delta: number;
  sign: 1 | -1;
  min: number;
  flexWidth: number;
  flexMin: number;
}): number {
  const { start, delta, sign, min, flexWidth, flexMin } = opts;
  const room = Math.max(0, flexWidth - flexMin);
  const max = Math.max(start + room, min);
  return Math.min(Math.max(start + delta * sign, min), max);
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

/**
 * Сетка ленты с учётом своих ширин. Колонка со своей шириной —
 * `minmax(0, …)`: на узком окне она сжимается вместе с остальными, а не
 * вылезает за край. Резиновая остаётся как есть.
 */
export function gridTemplateWith(
  tracks: readonly { key: string; size: string }[],
  map: ColumnWidthMap | undefined,
  flexKey: string
): string {
  return tracks
    .map((t) =>
      t.key !== flexKey && map && typeof map[t.key] === "number" && map[t.key] > 0
        ? `minmax(0, ${remWidth(map[t.key])})`
        : t.size
    )
    .join(" ");
}

/** Имя CSS-переменной для живой сетки во время перетаскивания. */
export function liveVarName(id: string): string {
  return `--cols-${id.replace(/[^a-zA-Z0-9_-]+/g, "_")}`;
}
