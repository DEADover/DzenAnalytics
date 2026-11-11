import { MONTHS_SHORT_GEN } from "../../../lib/months";
import { WEEKDAYS_SHORT } from "../../../lib/weekdays";
import { type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { InfoPopover } from "../../InfoPopover";
/**
 * Кирпичи главной страницы.
 *
 * Все варианты главной собираются из этих блоков — различается только
 * раскладка и оболочка. Иначе четыре варианта разъехались бы по мелочам, и
 * сравнивать пришлось бы не композицию, а случайные различия в отступах.
 *
 * Правила, общие для всех блоков:
 *   • цвет берётся ТОЛЬКО из токенов темы (`rgb(var(--c-…))`) — на старой
 *     главной в графиках стояли хексы тёмной темы, и в светлой линия «Чистый»
 *     давала контраст около 1,8:1;
 *   • доход и расход всегда несут знак «+» / «−» рядом с цветом: зелёный и
 *     красный при дейтеранопии различаются на ΔE 5.0, то есть почти никак;
 *   • атрибут `title` не используется — системные подсказки в проекте
 *     запрещены и недоступны с тача.
 */


export const WEEKDAYS = WEEKDAYS_SHORT;

/** «19 авг» — в узкой колонке полное название месяца переносит строку. */
export const MONTHS_SHORT = MONTHS_SHORT_GEN;

/* ─────────────────────────────  мелочи  ───────────────────────────── */

export function SectionLabel({
  children,
  right,
}: {
  children: ReactNode;
  /** Контрол раздела в конце строки — после черты, вровень с подписью. */
  right?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-x-3 gap-y-2 max-sm:flex-wrap">
      {/* Настоящий заголовок раздела, а не просто мелкий текст: на старой
          главной не было ни одного h2–h6, и с клавиатуры страница читалась
          как одно сплошное полотно. */}
      <h2 className="text-[11.5px] uppercase tracking-[0.12em] text-muted font-medium whitespace-nowrap">
        {children}
      </h2>
      <span className="flex-1 h-px bg-border" />
      {/* На телефоне правая часть — строкой ниже: рядом с подписью ей не
          хватало места, и «Ежедневный» уходил под край. */}
      {right && <div className="shrink-0 max-sm:basis-full">{right}</div>}
    </div>
  );
}

export function BlockTitle({
  title,
  info,
  to,
  linkLabel = "Все",
  right,
}: {
  title: ReactNode;
  /**
   * Пояснение к виджету. Живёт под значком рядом с заголовком, а не строкой
   * под ним: подпись у каждой карточки съедала место и делала шапки разной
   * высоты, а нужна она раз в жизни.
   */
  info?: ReactNode;
  to?: string;
  linkLabel?: string;
  right?: ReactNode;
}) {
  // Узкая шапка — на телефоне или в колонке в треть ширины — не вмещала
  // заголовок, подпись ссылки и переключатели: «К…» вместо «Капитал»,
  // «Запланированные…» на 1280 px. Подпись ссылки прячется по ширине САМОЙ
  // шапки (`.block-title` в index.css — container query), остаётся стрелка;
  // на телефоне переключатели уходят второй строкой (`sm:contents` — как было).
  return (
    <div
      className={`block-title flex items-center justify-between gap-x-3 gap-y-2 mb-3 ${
        right ? "flex-wrap" : "max-sm:flex-wrap"
      }`}
    >
      <div className="flex items-center gap-1.5 min-w-0 max-sm:flex-1">
        <h3 className="font-semibold text-[16px] sm:truncate">{title}</h3>
        {info && <InfoPopover label="Что это за график">{info}</InfoPopover>}
      </div>
      {right && (
        <div className="block-title-right max-sm:order-last max-sm:basis-full max-sm:min-w-0 sm:contents">
          {right}
        </div>
      )}
      {to && (
        <Link
          to={to}
          className="pill-link"
          // Подсказка — когда подпись спрятана (узкая шапка), видно, куда ведёт.
          title={linkLabel}
        >
          <span className="block-title-link-label">{linkLabel}</span>
          <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

/* ─────────────────────────────  графики  ───────────────────────────── */

/**
 * Подсказки графиков собраны на общем компоненте продукта
 * (`ChartTooltipCard` + `TooltipFacts`) — том же, что у графика месячного
 * бюджета. Своя вёрстка подсказки в каждом графике означала бы, что цвет
 * метки, порядок строк и подача разницы у каждого свои.
 */
export interface TipProps {
  active?: boolean;
  payload?: { payload?: Record<string, unknown> }[];
}
