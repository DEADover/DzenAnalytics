/**
 * Раскладка печатного дашборда — то, что считается ДО разметки.
 *
 * Полосы и бублики рисуются обычным CSS/SVG, а не библиотекой диаграмм:
 * печать — единственное место, где важно не «как показалось на экране», а как
 * лёг растр на бумагу, и предсказуемый прямоугольник тут надёжнее, чем чужой
 * рендер с анимацией и авто-размерами.
 *
 * Здесь только арифметика долей, чтобы её можно было проверить тестом.
 */

/** Одна полоса горизонтальной диаграммы. */
export interface PrintBar {
  label: string;
  /** null — показателя нет (нет базы для роста); рисуем прочерк, а не ноль. */
  value: number | null;
  /** Доля ширины полуоси, 0…1. */
  ratio: number;
  /** Значение отрицательное — полоса уходит влево от середины. */
  negative: boolean;
  /** Значение больше предела шкалы: полоса упёрлась в край. */
  clamped: boolean;
}

/**
 * Доли полос по набору значений.
 *
 * Масштаб общий на всю диаграмму и считается ПО МОДУЛЮ: у отклонения и роста
 * значения бывают обоих знаков, и мерить их разными линейками значит соврать о
 * соотношении. Пустые значения (`null`) в масштаб не входят.
 *
 * `cap` задаёт ПРЕДЕЛ шкалы и нужен процентам. У денег масштаб по максимуму
 * верен — там сравниваются величины. А у роста один выброс рушит картину:
 * рядом с «+2657 %» падение «−100 %» — предельное, дальше падать некуда —
 * съёживалось до четверти полосы, а остальные превращались в чёрточки. С
 * пределом полоса читается сама по себе, а выброс упирается в край и помечает
 * себя `clamped`.
 */
export function printBars(
  items: { label: string; value: number | null }[],
  opts: { cap?: number } = {}
): PrintBar[] {
  const finite = (v: number | null): v is number => v !== null && Number.isFinite(v);
  const max =
    opts.cap ??
    items.reduce((m, i) => (finite(i.value) ? Math.max(m, Math.abs(i.value)) : m), 0);
  return items.map(({ label, value }) => {
    if (!finite(value)) {
      return { label, value: null, ratio: 0, negative: false, clamped: false };
    }
    const size = Math.abs(value);
    return {
      label,
      value,
      ratio: max > 0 ? Math.min(size, max) / max : 0,
      negative: value < 0,
      clamped: max > 0 && size > max,
    };
  });
}

/** Есть ли в наборе отрицательные — от этого зависит, нужна ли ось посередине. */
export function hasNegative(bars: PrintBar[]): boolean {
  return bars.some((b) => b.negative);
}

/** Доля бублика: длина дуги и смещение для `stroke-dasharray`. */
export interface DonutSlice {
  /** Доля окружности, 0…1. */
  share: number;
  /** Сколько окружности занято предыдущими долями, 0…1. */
  offset: number;
  color: string;
}

/**
 * Бублик «выполнение плана»: освоено, перерасход, остаток.
 *
 * Те же три доли, что в Excel и в месячной карточке. Считаем именно так, а не
 * «факт против плана»: при перерасходе остаток ушёл бы в минус и дуга поехала
 * бы назад.
 */
export function donutSlices(
  fact: number,
  plan: number,
  colors: { used: string; over: string; rest: string }
): DonutSlice[] {
  const used = Math.max(0, Math.min(fact, plan));
  const over = Math.max(0, fact - plan);
  const rest = Math.max(0, plan - fact);
  const total = used + over + rest;
  if (total <= 0) return [{ share: 1, offset: 0, color: colors.rest }];
  const parts = [
    { value: used, color: colors.used },
    { value: over, color: colors.over },
    { value: rest, color: colors.rest },
  ];
  let offset = 0;
  const out: DonutSlice[] = [];
  for (const p of parts) {
    if (p.value <= 0) continue;
    const share = p.value / total;
    out.push({ share, offset, color: p.color });
    offset += share;
  }
  return out;
}

/**
 * Геометрия печатного листа в пикселях при 96 точках на дюйм.
 *
 * ДОЛЖНА совпадать с `.print-*` в `index.css` — там те же величины заданы в
 * миллиметрах и пунктах. Держать их порознь неприятно, но иначе раскладку
 * пришлось бы считать после рендера и перерисовывать страницу второй раз.
 * Расхождение ловится тестом `rowsPerPage` и видно сразу: у нижнего ряда
 * диаграмм срезает последние строки.
 */
export const SHEET = {
  /** Лист A4 landscape: 297 × 210 мм. */
  height: 794,
  /** Поля страницы, 10 мм с каждой стороны. */
  padding: 38 * 2,
  /** Шапка листа со статьями вместе с отступом под ней. */
  header: 74,
  /** Просвет между рядами диаграмм, 5 мм. */
  gap: 19,
  /** Рамка диаграммы: поля, заголовок и отступ под ним. */
  chrome: 47,
  /** Высота одной строки без просвета. */
  row: 15,
  /** Просвет между строками, 1 мм. */
  rowGap: 4,
} as const;

export type SheetGeometry = { -readonly [K in keyof typeof SHEET]: number };

/**
 * Сколько статей влезает на лист.
 *
 * Считаем, а не подбираем на глаз: при шести диаграммах в три ряда на строки
 * остаётся заметно меньше места, чем кажется, и лишние срезались нижним краем
 * листа — «Рост» уходил в никуда.
 *
 * Величины в `SHEET` не выдуманы, а СНЯТЫ с готовой вёрстки в браузере: на
 * глаз строка кажется 15 пикселями, а с просветом занимает все 18,4, и на трёх
 * рядах эта разница даёт лишние полтора десятка строк.
 *
 * `chartRows` — сколько РЯДОВ диаграмм на листе (по две в ряд).
 */
export function rowsPerPage(chartRows: number, sheet: SheetGeometry = SHEET): number {
  const usable = sheet.height - sheet.padding - sheet.header;
  const perRow = (usable - sheet.gap * Math.max(0, chartRows - 1)) / chartRows;
  // Последняя строка идёт без просвета — отсюда «+ rowGap» в числителе.
  const forRows = perRow - sheet.chrome + sheet.rowGap;
  // Округляем ВНИЗ: лишний лист лучше срезанной строки.
  return Math.max(1, Math.floor(forRows / (sheet.row + sheet.rowGap)));
}

/**
 * Разбить статьи по листам.
 *
 * Режем САМ СПИСОК, а не полагаемся на переносы браузера: диаграммы идут
 * парами в ряд, и разрыв внутри ряда оставил бы половину полос в отрыве от
 * подписей. Каждый лист получает свой кусок статей, а заголовок повторяется.
 */
export function paginate<T>(items: T[], perPage: number): T[][] {
  if (perPage <= 0) return [items];
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += perPage) pages.push(items.slice(i, i + perPage));
  return pages.length > 0 ? pages : [[]];
}
