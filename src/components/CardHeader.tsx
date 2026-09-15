import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import clsx from "clsx";
import { InfoPopover } from "./InfoPopover";

/** Цвет значка: акцент, а другой — когда карточка про расходы, доходы и т. п. */
export type CardHeaderTone = "accent" | "accent2" | "income" | "expense" | "warn" | "muted";

const ICON_TONE: Record<CardHeaderTone, string> = {
  accent: "text-accent",
  accent2: "text-accent2",
  income: "text-income",
  expense: "text-expense",
  warn: "text-warn",
  muted: "text-muted",
};

/**
 * Шапка карточки: значок 16, заголовок 600, «?» с пояснением, строка
 * подписи под заголовком и правый угол под компактные контролы (выгрузка,
 * переключатель, счётчик).
 *
 * Одна на все карточки: прежде три десятка страниц верстали её сами — с
 * отступом снизу 8, 12 и 16, значком то слева от заголовка, то без него, и
 * подписью то 12, то 11 px.
 *
 * Высота строки — ступень 34 всегда, есть справа кнопка или нет: иначе у
 * соседних карточек содержимое начиналось бы с разной высоты.
 *
 * Правый угол не переносится на отдельную строку: длинный заголовок
 * обрезается, а кнопки остаются на своей высоте. С переносом «CSV» уезжал
 * вниз, стоило заголовку оказаться длиннее свободного места. Переносится
 * ряд только на телефоне, где иначе кнопкам не хватит места вовсе.
 *
 * На телефоне правый угол, уехав на свою строку, ещё и сжимается до её
 * ширины, а его кнопки переносятся: иначе ряд из поиска и двух кнопок
 * оставался шириной в десктопный и вылезал за экран.
 */
export function CardHeader({
  icon: Icon,
  tone = "accent",
  title,
  subtitle,
  info,
  infoLabel,
  right,
  className,
}: {
  icon?: LucideIcon;
  tone?: CardHeaderTone;
  title: ReactNode;
  /** Строка под заголовком: что сейчас показано — период, выбор, счёт. */
  subtitle?: ReactNode;
  /** Как это считается — под знаком вопроса рядом с заголовком. */
  info?: ReactNode;
  infoLabel?: string;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "flex items-center justify-between gap-x-3 gap-y-2 max-sm:flex-wrap min-h-[34px]",
        subtitle ? "mb-3" : "mb-2",
        className
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0 font-semibold">
          {Icon && <Icon className={clsx("w-4 h-4 shrink-0", ICON_TONE[tone])} aria-hidden />}
          <span className="min-w-0 truncate">{title}</span>
          {info && <InfoPopover label={infoLabel}>{info}</InfoPopover>}
        </div>
        {subtitle && <div className="text-xs text-muted mt-0.5">{subtitle}</div>}
      </div>
      {right && (
        <div className="flex items-center gap-2 shrink-0 max-sm:flex-wrap max-sm:shrink max-sm:min-w-0">
          {right}
        </div>
      )}
    </div>
  );
}
