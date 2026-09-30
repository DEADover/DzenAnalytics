/**
 * Своя ширина столбцов — расчёты без DOM и React.
 *
 * Граница между колонками двигается как перегородка: две колонки по её
 * сторонам делят место между собой, остальные стоят на месте. Таблица всегда
 * во всю ширину карточки, прокрутки вбок нет. Сохранённые ширины — доли: на
 * другом окне колонки сохраняют пропорции.
 *
 * Так решено 30.09.2026 после трёх попыток. Сначала разницу забирала
 * «резиновая» колонка (название, комментарий) — даже не соседняя. Потом
 * менялась только тянутая колонка, а таблица росла вбок с прокруткой —
 * «такого быть не должно». Потом таблица упиралась в край карточки — и левый
 * край «Комментария» нельзя было сдвинуть вправо, чтобы сузить его.
 */

/** Сохранённые ширины одной таблицы: ключ колонки → `rem` при тексте 14 px. */
export type ColumnWidthMap = Record<string, number>;

/**
 * Сдвиг границы между колонками на `delta` пикселей: левая растёт на столько
 * же, на сколько сужается правая, и ни одна не становится уже своей подписи.
 * `clamped` — упёрлись в подпись.
 */
export function splitWidths(
  left: number,
  right: number,
  delta: number,
  minLeft: number,
  minRight: number
): { left: number; right: number; clamped: boolean } {
  const lo = Math.min(0, minLeft - left);
  const hi = Math.max(0, right - minRight);
  const d = Math.min(Math.max(delta, lo), hi);
  return { left: left + d, right: right - d, clamped: d !== delta };
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
 * Раскладка таблицы со своими ширинами: колонки — доли таблицы во всю
 * ширину. Если у какой-то колонки ширину не узнать — `null`, таблица
 * остаётся как была.
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
 * Сетка ленты со своими ширинами: у колонки со своей шириной — доля
 * `minmax(0, Nfr)`, у прочих (чекбокс, кнопки) — дорожка по умолчанию. Доли
 * делят всё место, что осталось от неизменных дорожек, — лента всегда во всю
 * ширину и на любом окне сохраняет пропорции.
 */
export function gridTemplateWith(
  tracks: readonly { key: string; size: string }[],
  map: ColumnWidthMap | undefined
): string {
  return tracks
    .map((t) => {
      const w = stored(map, t.key);
      return w ? `minmax(0, ${w}fr)` : t.size;
    })
    .join(" ");
}

/** Имя CSS-переменной для живой сетки во время перетаскивания. */
export function liveVarName(id: string): string {
  return `--cols-${id.replace(/[^a-zA-Z0-9_-]+/g, "_")}`;
}
