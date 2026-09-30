import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import clsx from "clsx";

/**
 * Пункт выпадающего меню: значок, подпись и, по желанию, пояснение справа
 * (сумма, дата). Один на меню строки бюджета и меню запланированной операции.
 */
export function MenuItem({
  icon: Icon,
  danger,
  disabled,
  hint,
  title,
  onClick,
  children,
}: {
  icon: LucideIcon;
  /** Разрушительное действие — красным. */
  danger?: boolean;
  disabled?: boolean;
  /** Пояснение справа — например, во что превратится план. */
  hint?: ReactNode;
  /** Подсказка при наведении. */
  title?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={clsx(
        "w-full text-left px-2.5 py-1.5 rounded-md flex items-center gap-2 hover:bg-panel2 disabled:opacity-40 disabled:pointer-events-none",
        danger && "text-expense"
      )}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="flex-1 min-w-0 truncate">{children}</span>
      {hint && <span className="shrink-0 text-muted tabular-nums">{hint}</span>}
    </button>
  );
}
