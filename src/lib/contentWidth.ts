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
/** С чего начинается ограничение, когда его включают впервые. */
export const CONTENT_WIDTH_DEFAULT = 1920;

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

/**
 * Значение CSS-переменной `--content-max`. «Во весь экран» — `100%`, а не
 * `none`: переменная участвует в `calc()` отступов колонки, и с `none` они
 * перестали бы считаться вовсе.
 */
export function contentMaxCss(width: number): string {
  return width > 0 ? `${width}px` : "100%";
}
