/**
 * Своя ширина столбцов — расчёты без DOM и React.
 *
 * Тянешь правый край колонки — меняется только она, остальные сохраняют
 * ширину и сдвигаются. Шире карточки таблица не становится: прокрутки вбок
 * быть не должно (30.09.2026), поэтому расширять колонку можно только за счёт
 * свободного места справа — его освобождает сужение другой колонки. На узком
 * окне сохранённые ширины сжимаются под него, а не вылезают за край.
 *
 * История: сначала разницу забирала «резиновая» колонка (название,
 * комментарий) — и менялась соседняя («хочется, чтобы изменение размера
 * столбца не меняло размеры рядом стоящего»); потом таблица росла вбок с
 * прокруткой — «страницы стали листаться по горизонтали, такого быть не
 * должно».
 *
 * Ширины хранятся в `rem` при обычном размере текста таблиц — так они растут
 * вместе с настройкой «Размер текста в таблицах», как и ширины по умолчанию.
 */

/** Сохранённые ширины одной таблицы: ключ колонки → `rem` при тексте 14 px. */
export type ColumnWidthMap = Record<string, number>;

/**
 * Новая ширина колонки при сдвиге её правого края на `delta` пикселей: не
 * уже подписи и не шире, чем позволяет свободное место справа (`free`).
 */
export function clampWidth(start: number, delta: number, min: number, free: number): number {
  const max = Math.max(start + Math.max(0, free), min);
  return Math.min(Math.max(start + delta, min), max);
}

/**
 * Пиксели в `rem` при обычном размере текста таблиц, с точностью до сотой.
 * Вниз, а не до ближайшего: иначе сумма снятых ширин выходила на долю пикселя
 * шире карточки, и самая широкая колонка ужималась на пиксель.
 */
export function pxToRem(px: number, remPx: number, scale: number): number {
  const unit = remPx * (scale > 0 ? scale : 1);
  return Math.floor((px / unit) * 100 + 1e-6) / 100;
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

/** Ширина по умолчанию в `rem`: «8rem» → 8, «84px» → 5,25. Проценты, `auto` и формулы — не число. */
export function widthToRem(width: string | undefined, remPx = 16): number | undefined {
  if (!width) return undefined;
  const m = /^\s*(\d+(?:\.\d+)?)(rem|px)\s*$/.exec(width);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  return m[2] === "rem" ? n : n / remPx;
}

export interface TableLayout {
  /** Ширина таблицы — сумма колонок (CSS). */
  total: string;
  /** Колонки — доли таблицы: на узком окне сжимаются вместе с ней. */
  cols: Record<string, string>;
  /** Колонки перед колонками хука (чекбокс выбора) — тоже доли. */
  lead: string[];
}

const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;

/**
 * Раскладка таблицы со своими ширинами. Таблица шириной в сумму колонок, но
 * не шире карточки (`min(…, 100%)`), а колонки — долями таблицы: пока места
 * хватает, доля даёт ровно сохранённую ширину, на узком окне все колонки
 * сжимаются вместе, и прокрутки вбок нет. Если у какой-то колонки ширину
 * не узнать — `null`, таблица остаётся как была.
 */
export function tableLayout(
  cols: readonly { key: string; width?: string }[],
  map: ColumnWidthMap | undefined,
  lead: readonly string[] = []
): TableLayout | null {
  const leadRem = lead.map((w) => widthToRem(w));
  const colRem = cols.map((c) => stored(map, c.key) ?? widthToRem(c.width));
  if (leadRem.some((r) => r === undefined) || colRem.some((r) => r === undefined)) return null;
  const total = [...leadRem, ...colRem].reduce<number>((s, r) => s + (r ?? 0), 0);
  if (total <= 0) return null;
  const pct = (r: number) => `${round((r / total) * 100, 4)}%`;
  return {
    total: remWidth(round(total, 2)),
    cols: Object.fromEntries(cols.map((c, i) => [c.key, pct(colRem[i]!)])),
    lead: leadRem.map((r) => pct(r!)),
  };
}

/**
 * Сетка ленты со своими ширинами. Колонка со своей шириной —
 * `minmax(0, ширина)`: пока места хватает, она ровно своей ширины, а
 * свободное место остаётся справа; на узком окне первыми сжимаются самые
 * широкие колонки, и за край лента не вылезает. Пустой дорожки под свободное
 * место нет: у сетки зазор между колонками, и лишняя дорожка отняла бы его у
 * остальных.
 */
export function gridTemplateWith(
  tracks: readonly { key: string; size: string }[],
  map: ColumnWidthMap | undefined
): string {
  return tracks
    .map((t) => {
      const w = stored(map, t.key);
      return w ? `minmax(0, ${remWidth(w)})` : t.size;
    })
    .join(" ");
}

/** Имя CSS-переменной для живой сетки во время перетаскивания. */
export function liveVarName(id: string): string {
  return `--cols-${id.replace(/[^a-zA-Z0-9_-]+/g, "_")}`;
}
