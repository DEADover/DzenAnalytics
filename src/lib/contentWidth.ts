/**
 * Ширина сервиса: на сверхшироком мониторе (21:9, 3440 px) страница
 * растягивалась до краёв, и таблицы и графики приходилось читать поворотом
 * головы. Настройка ставит всё — строку шапки, панель фильтров, страницу и
 * угловые кнопки — в колонку не шире заданного по центру экрана. Подложки
 * (стекло шапки и панели фильтров, фон страницы) остаются во всю ширину.
 *
 * Значение — ширина колонки в пикселях вместе с её полями; 0 — «Во весь
 * экран», как было всегда и остаётся по умолчанию. Экран уже колонки ничего
 * не замечает: ограничение действует только там, где места больше.
 *
 * Применяется одной CSS-переменной `--content-max` на корне (`index.css`):
 * отступы колонки считаются из неё прямо в CSS, без перерисовки React.
 */

import { formatNum } from "./format";

/** «Во весь экран» — ограничения нет. */
export const CONTENT_WIDTH_FULL = 0;
/**
 * Нижний край. Уже 1280 шапка переходит на знак вместо логотипа и прячет
 * значки в пунктах меню — колонка уже этого на широком экране только мешала бы.
 */
export const CONTENT_WIDTH_MIN = 1280;
/** Верхний край: шире на мониторе 3440 уже почти «во весь экран». */
export const CONTENT_WIDTH_MAX = 2560;
/** Шаг бегунка: шестнадцать ступеней между краями. */
export const CONTENT_WIDTH_STEP = 80;
/**
 * Крайнее правое положение бегунка — «Во весь экран». Следующая ступень после
 * самой широкой колонки: двигая бегунок вправо, человек расширяет колонку, а
 * в конце снимает ограничение вовсе. Отдельного переключателя нет — строка
 * устроена так же, как «Размер текста в таблицах».
 */
export const CONTENT_WIDTH_SLIDER_FULL = CONTENT_WIDTH_MAX + CONTENT_WIDTH_STEP;

/**
 * Привести пришедшее (с диска, из облака, с бегунка) к допустимому значению:
 * 0 — во весь экран; число — в пределах и на шаге бегунка. Мусор — во весь
 * экран: так сервис выглядит, как выглядел всегда.
 */
export function normalizeContentWidth(v: unknown): number {
  const n = typeof v === "number" ? v : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) return CONTENT_WIDTH_FULL;
  const clamped = Math.min(CONTENT_WIDTH_MAX, Math.max(CONTENT_WIDTH_MIN, n));
  const snapped =
    CONTENT_WIDTH_MIN + Math.round((clamped - CONTENT_WIDTH_MIN) / CONTENT_WIDTH_STEP) * CONTENT_WIDTH_STEP;
  return Math.min(CONTENT_WIDTH_MAX, snapped);
}

/** Годится ли значение как есть — проверка записи с другого устройства. */
export function isContentWidth(v: unknown): v is number {
  return typeof v === "number" && normalizeContentWidth(v) === v;
}

/** Положение бегунка для сохранённой ширины. */
export function contentWidthToSlider(width: number): number {
  const w = normalizeContentWidth(width);
  return w === CONTENT_WIDTH_FULL ? CONTENT_WIDTH_SLIDER_FULL : w;
}

/** Ширина для положения бегунка: крайнее правое — во весь экран. */
export function sliderToContentWidth(position: number): number {
  if (!Number.isFinite(position) || position >= CONTENT_WIDTH_SLIDER_FULL) return CONTENT_WIDTH_FULL;
  return normalizeContentWidth(position);
}

/** Значение словами: «Во весь экран» или «1 920 px». */
export function formatContentWidth(width: number): string {
  const w = normalizeContentWidth(width);
  return w === CONTENT_WIDTH_FULL ? "Во весь экран" : `${formatNum(w)} px`;
}

/**
 * Значение CSS-переменной `--content-max`. «Во весь экран» — `100%`, а не
 * `none`: переменная участвует в `calc()` отступов колонки, и с `none` они
 * перестали бы считаться вовсе.
 */
export function contentMaxCss(width: number): string {
  return width > 0 ? `${width}px` : "100%";
}
