import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import clsx from "clsx";

const ICON_TONE = {
  muted: "text-muted",
  income: "text-income",
  accent: "text-accent",
} as const;

/**
 * Пустое место в разделе: значок 40, заголовок, пояснение — что сделать,
 * чтобы данные появились, — и при случае одно действие.
 *
 * Прежде пустоту верстали на каждой странице заново: поля сверху 48, 56 и
 * 64, заголовок то 500, то 600, значок 40 или 56 в круге, а где-то вместо
 * заголовка стояла одна серая строка. Один и тот же смысл «здесь пока
 * ничего нет» выглядел по-разному.
 *
 * `card` — отдельной карточкой в потоке страницы; `inline` — внутри уже
 * существующей карточки, списка или окна, без своей рамки; `compact` — в
 * тесном месте (виджет главной, короткий список), обычно одной строкой.
 */
export function SectionEmpty({
  icon: Icon,
  tone = "muted",
  title,
  children,
  action,
  variant = "card",
  className,
}: {
  icon?: LucideIcon;
  /** `income` — пусто, и это хорошо: «Все операции категоризированы». */
  tone?: keyof typeof ICON_TONE;
  title?: ReactNode;
  /** Пояснение: почему пусто и что поменять. */
  children?: ReactNode;
  /** Одна кнопка, если пустоту можно заполнить сразу. */
  action?: ReactNode;
  variant?: "card" | "inline" | "compact";
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "flex flex-col items-center text-center",
        variant === "card" ? "card-tray card-pad py-12" : variant === "inline" ? "py-10" : "py-6",
        className
      )}
    >
      {Icon && <Icon className={clsx("w-10 h-10 mb-3", ICON_TONE[tone])} aria-hidden="true" />}
      {title && <div className="text-base font-medium mb-1">{title}</div>}
      {children && <div className="text-sm text-muted max-w-md">{children}</div>}
      {action && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}
