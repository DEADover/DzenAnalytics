import type { ComponentType, ReactNode } from "react";
import { useLocation } from "react-router-dom";
import clsx from "clsx";
import { sectionGroupTitle } from "../lib/navSections";

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
   * Подпись: одной короткой строкой, что здесь можно понять или сделать.
   * Подпись раздела в меню «Ещё» (`navSections`) говорит, что внутри, — эта её
   * не повторяет.
   */
  hint?: ReactNode;
  /**
   * «?» о разделе — `InfoPopover`. Стоит сразу за названием: пояснение
   * относится к названию, а у правого края оно оказывалось в другом конце
   * экрана.
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
 * Одна тонкая строка: значок 16, крошки «Группа / Раздел», «?» и подпись —
 * всё в ряд. Прежде здесь стоял блок в два этажа со значком 52 в плашке, и
 * пользователи справедливо сказали, что до первых чисел остаётся полэкрана
 * (16.09.2026, выбран вариант 1 из пяти на холсте). Теперь шапка занимает
 * строку и читается как хлебные крошки, а не как обложка.
 *
 * Группа слева от названия — не украшение: у разделов из «Ещё» в дорожке меню
 * подсвечена только кнопка «Ещё», и по одному названию не понять, куда ты
 * попал. «Аналитика / Календарь» отвечает на это сразу.
 *
 * Подпись на узком экране переносится второй строкой, а не прячется: она
 * короткая, и потерять её хуже, чем занять 20 px.
 */
export function PageHeader({
  title,
  icon: Icon,
  iconTone = "text-accent",
  hint,
  info,
  right,
}: Props) {
  const { pathname } = useLocation();
  const group = sectionGroupTitle(pathname);

  return (
    // `-mb-3` съедает половину шага `space-y-6`, на котором собраны все
    // страницы: крошки — не блок содержимого, и отбивать их от первой карточки
    // наравне с остальными блоками незачем.
    <div className="-mb-3 flex items-center flex-wrap gap-x-3 gap-y-1">
      <div className="min-w-0 flex items-center gap-2">
        {Icon && <Icon aria-hidden className={clsx("w-4 h-4 shrink-0", iconTone)} />}
        <div className="min-w-0 flex items-center gap-1.5 text-[15px] leading-6">
          {group && (
            <>
              {/* Группа и слэш — приглушённые: ведёт название, крошки только
                  подсказывают, откуда раздел. */}
              <span className="text-muted shrink-0">{group}</span>
              <span aria-hidden className="text-border shrink-0">
                /
              </span>
            </>
          )}
          <h1 className="font-semibold truncate">{title}</h1>
        </div>
        {info}
      </div>

      {/* Волосок отделяет подпись от названия — без него строка читалась
          сплошняком. На переносе он не нужен: там разделяет сама строка. */}
      {hint && (
        <>
          <span aria-hidden className="w-px h-3.5 bg-border shrink-0 max-md:hidden" />
          <p className="text-sm text-muted min-w-0 truncate">{hint}</p>
        </>
      )}

      {right && <div className="ml-auto shrink-0">{right}</div>}
    </div>
  );
}
