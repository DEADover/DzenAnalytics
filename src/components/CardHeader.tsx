import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import clsx from "clsx";
import { InfoPopover } from "./InfoPopover";

/**
 * Шапка карточки: значок 16 цвета акцента, заголовок 16/600, «?» с пояснением
 * и правый угол под компактные контролы (выгрузка, переключатель, счётчик).
 *
 * Высота строки — ступень 34 всегда, есть справа кнопка или нет: иначе у
 * соседних карточек содержимое начиналось бы с разной высоты.
 */
export function CardHeader({
  icon: Icon,
  title,
  info,
  infoLabel,
  right,
  className,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  /** Как это считается — под знаком вопроса рядом с заголовком. */
  info?: ReactNode;
  infoLabel?: string;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("flex items-center justify-between gap-3 min-h-[34px] mb-2", className)}>
      <div className="flex items-center gap-1.5 min-w-0 font-semibold">
        {Icon && <Icon className="w-4 h-4 shrink-0 text-accent" aria-hidden />}
        <span className="min-w-0 truncate">{title}</span>
        {info && <InfoPopover label={infoLabel}>{info}</InfoPopover>}
      </div>
      {right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
    </div>
  );
}
