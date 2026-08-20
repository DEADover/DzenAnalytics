import type { ComponentType, ReactNode } from "react";

interface Props {
  /**
   * Page title. Always rendered as `<h1>`.
   */
  title: string;
  /**
   * Optional Lucide icon (or any component that accepts `className`).
   * When present, renders alongside the title; the icon is the
   * page's identity-tag at-a-glance.
   */
  icon?: ComponentType<{ className?: string }>;
  /**
   * Icon colour class. Defaults to the accent; pass e.g. `text-warn` for
   * attention pages (Аномалии, Дубликаты) so the icon keeps its semantics.
   */
  iconTone?: string;
  /**
   * Short subtitle / hint text shown under the title in muted style.
   */
  hint?: ReactNode;
  /**
   * Optional right-aligned slot for page-level actions
   * (e.g. "Снимок PNG", "Экспорт", year selector). The header arranges
   * itself with `flex items-end justify-between flex-wrap gap-3` so this
   * stays balanced against the title block on wide viewports and wraps
   * cleanly on narrow ones.
   */
  right?: ReactNode;
  /**
   * Allow the hint to wrap onto multiple lines instead of truncating to one.
   * Off by default (keeps header heights uniform); opt in for pages with a
   * genuinely longer subtitle.
   */
  hintWrap?: boolean;
}

/**
 * Shared page header used by every top-level route.
 *
 * Replaces the ad-hoc `<div><h1><p></div>` block that every page used to
 * inline. Guarantees three things across the product:
 *   1. Same typographic scale и один ряд: значок в плашке, заголовок,
 *      волосок, подпись.
 *   2. Every page can show an identity icon — so navigation feels
 *      consistent regardless of which page you land on.
 *   3. A single, predictable slot for page-level actions on the right.
 */
export function PageHeader({
  title,
  icon: Icon,
  iconTone = "text-accent",
  hint,
  right,
  hintWrap,
}: Props) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-3">
      {/* Заголовок и подпись стоят в ОДНУ строку, разделённые волоском.
          Двумя строками шапка занимала около шестидесяти пикселей на каждой из
          двадцати шести страниц — и это до того, как начиналась сама страница.
          Подпись при этом никуда не убрана: на редких разделах вроде «50/30/20»
          или «Что-если» она объясняет, что страница вообще делает.

          Если строка не помещается, подпись переносится вниз — то есть в худшем
          случае получается ровно прежняя раскладка, а не обрезанный текст. */}
      <div className="min-w-0 flex items-center gap-3 flex-wrap">
        <h1 className="text-[26px] font-semibold tracking-tight flex items-center gap-3 min-w-0">
          {/* Значок в плашке, а не голым глифом: во всём остальном продукте —
              в меню, в быстрых переходах, в переключателях — иконки сидят в
              залитых плашках, и только заголовок висел особняком. Плашка
              нейтральная, чтобы работать с любым тоном значка: у страниц
              внимания («Аномалии», «Дубликаты») он не акцентный. */}
          {Icon && (
            <span className="shrink-0 w-9 h-9 rounded-xl bg-panel2 border border-border grid place-items-center">
              <Icon className={`w-[18px] h-[18px] ${iconTone}`} />
            </span>
          )}
          <span className="truncate">{title}</span>
        </h1>
        {hint && (
          <>
            <span
              aria-hidden
              className="hidden md:block w-px h-5 bg-border shrink-0"
            />
            {/* 14.5px, а не прежние 13.5: рядом с заголовком в 26px подпись
                читалась как служебная сноска, хотя на половине разделов именно
                она объясняет, что страница делает. Ступень взята из той же
                шкалы, что и строки в карточках дашборда, — крупнее подпись уже
                начала бы спорить с заголовком. */}
            <p
              className={`text-muted text-[14.5px] min-w-0 ${hintWrap ? "" : "truncate"}`}
              title={typeof hint === "string" ? hint : undefined}
            >
              {hint}
            </p>
          </>
        )}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}
