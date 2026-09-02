import { createElement } from "react";
import { zenIconToLucide, FALLBACK_CATEGORY_ICON } from "../lib/zenIconLucide";

/**
 * Иконка категории по её id из Дзен-мани.
 *
 * Раньше каждое место доставало компонент в переменную с большой буквы
 * (`const Glyph = zenIconToLucide(id) || FALLBACK`) и рисовало `<Glyph />`.
 * Работало это верно — таблица отдаёт один и тот же модульный компонент, —
 * но со стороны читалось как объявление компонента прямо в рендере, а это
 * совсем другая вещь: настоящий компонент, созданный при отрисовке, терял бы
 * состояние на каждой перерисовке. Здесь берём компонент из таблицы явно,
 * через `createElement`, и заодно перестаём в четырёх местах повторять откат
 * на запасную иконку.
 */
export function ZenIcon({
  id,
  className,
  style,
}: {
  /** Id иконки в Дзен-мани; пусто или незнакомый — рисуем запасную. */
  id: string | null | undefined;
  className?: string;
  style?: React.CSSProperties;
}) {
  return createElement(zenIconToLucide(id) || FALLBACK_CATEGORY_ICON, {
    className,
    style,
  });
}
