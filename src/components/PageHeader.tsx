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
   * Подпись под названием: одной короткой строкой, что здесь можно понять или
   * сделать. Подпись раздела в меню «Ещё» (`navSections`) говорит, что внутри,
   * — эта её не повторяет.
   */
  hint?: ReactNode;
  /**
   * «?» о разделе — `InfoPopover`. Стоит сразу за названием, на его строке:
   * пояснение относится к названию, а у правого края оно оказывалось в другом
   * конце экрана.
   */
  info?: ReactNode;
  /**
   * Правый угол — только действия над разделом целиком («Новая цель»,
   * «Удалить окончательно»), компактной ступенью 34.
   *
   * Настройкам того, что показано, — бегункам, году, режиму, периоду — здесь
   * не место: они стоят в `SectionControls` под общим фильтром, рядом с тем,
   * что меняют.
   */
  right?: ReactNode;
}

/**
 * Шапка раздела — одна на все страницы.
 *
 * Две строки: название 24 / 32 и под ним подпись 14 / 20, слева — значок в
 * плашке 52. Плашка ровно в высоту двух строк, поэтому текст не выше значка и
 * шапка читается одним блоком. Так выбрал пользователь из пяти вариантов на
 * холсте (15.09.2026): прежде название и подпись стояли в одну строку через
 * волосок и читались как цепочка «раздел | пояснение», а не как заголовок с
 * подзаголовком.
 *
 * Значок в плашке, а не голым глифом: в меню, быстрых переходах и
 * переключателях иконки сидят в залитых плашках. Плашка нейтральная, чтобы
 * работать с любым тоном значка — у страниц внимания («Аномалии»,
 * «Дубликаты») он не акцентный.
 */
export function PageHeader({
  title,
  icon: Icon,
  iconTone = "text-accent",
  hint,
  info,
  right,
}: Props) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-3">
      <div className="min-w-0 flex items-center gap-3.5">
        {Icon && (
          <span
            aria-hidden
            className="shrink-0 w-[52px] h-[52px] rounded-2xl bg-panel2 border border-border grid place-items-center"
          >
            <Icon className={`w-6 h-6 ${iconTone}`} />
          </span>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <h1 className="text-2xl font-semibold truncate">{title}</h1>
            {info}
          </div>
          {/* Без всплывающей подсказки и без обрезки: подсказка повторяла бы
              то, что уже написано, а подпись, которой не хватило строки,
              переносится целиком. Подпись — одна короткая строка; объяснения
              на абзац ей не место, для них есть «?». */}
          {hint && <p className="text-sm text-muted">{hint}</p>}
        </div>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}
