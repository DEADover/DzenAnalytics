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
  /** Поля страницы: 10 мм сверху и 6 мм снизу. */
  padding: 38 + 23,
  /** Шапка листа со статьями вместе с отступом под ней. */
  header: 76,
  /** Просвет между рядами диаграмм, 5 мм. */
  gap: 19,
  /** Рамка диаграммы: поля, заголовок и отступ под ним. */
  chrome: 51,
  /** Высота одной строки без просвета: подпись в 10 пунктов и полоса под ней. */
  row: 20,
  /** Просвет между строками, 1 мм. */
  rowGap: 4,
} as const;

/**
 * Книжный лист — на нём идут разрезы по статьям (issue #68).
 *
 * Альбомный остался только у первой страницы со сводкой: там четыре плитки в
 * ряд и два бублика, им нужна ширина. А списку статей нужна ВЫСОТА — в книжной
 * ориентации на лист помещается заметно больше строк, и разрез реже рвётся на
 * продолжения.
 */
export const SHEET_PORTRAIT: SheetGeometry = {
  ...SHEET,
  /** Лист A4 portrait: 210 × 297 мм. */
  height: 1123,
};

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
/**
 * Разбить по листам, НЕ разрывая категорию и её под-категории.
 *
 * У ветки на листе-продолжении нет родителя над ней, и подпись приходится
 * писать полным именем («Зачисление · Т-Банк - Нак.счет (Отпуск)») — а оно в
 * колонку не влезает и обрезается многоточием. Поэтому режем не по строкам, а
 * по группам: категория уходит на следующий лист целиком, вместе со своими
 * под-категориями.
 *
 * `isChild` говорит, что строка — под-категория предыдущей категории. Группа
 * больше листа (у переводов бывает под сорок счетов) всё же делится: лист
 * фиксированной высоты, и выбор тут между переносом и обрезкой.
 */
export function paginateGroups<T>(
  items: T[],
  perPage: number,
  isChild: (item: T) => boolean
): T[][] {
  if (perPage <= 0) return [items];
  if (items.length === 0) return [[]];
  const groups: T[][] = [];
  for (const item of items) {
    if (!isChild(item) || groups.length === 0) groups.push([item]);
    else groups[groups.length - 1].push(item);
  }
  // Цель по строкам на лист — как в `paginate`: столько же листов, но ровнее.
  const target = Math.ceil(items.length / Math.ceil(items.length / perPage));
  const pages: T[][] = [];
  let page: T[] = [];
  for (const group of groups) {
    if (page.length > 0 && page.length + group.length > Math.max(target, 1)) {
      pages.push(page);
      page = [];
    }
    if (group.length > perPage) {
      // Группа не помещается ни на один лист — режем её саму, иначе нижние
      // строки просто срежет краем.
      if (page.length > 0) {
        pages.push(page);
        page = [];
      }
      for (let i = 0; i < group.length; i += perPage) pages.push(group.slice(i, i + perPage));
      continue;
    }
    page.push(...group);
  }
  if (page.length > 0) pages.push(page);
  return pages.length > 0 ? pages : [[]];
}

export function paginate<T>(items: T[], perPage: number): T[][] {
  if (perPage <= 0) return [items];
  if (items.length === 0) return [[]];
  // Листов столько же, сколько при делении встык, а вот строки на них лежат
  // ПОРОВНУ: тридцать семь статей по восемнадцать — это 18 + 18 + 1, и третий
  // лист выходил с одной строкой и пустым листом под ней. Те же три листа по
  // 13 + 12 + 12 читаются как отчёт, а не как обрывок.
  const pages = Math.ceil(items.length / perPage);
  const size = Math.ceil(items.length / pages);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
