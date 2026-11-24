import type { ReactNode } from "react";
import { Check, type LucideIcon } from "lucide-react";
import clsx from "clsx";

/**
 * Пункт выпадающего меню: значок, подпись и, по желанию, пояснение справа
 * (сумма, дата). Один на меню строки бюджета, меню запланированной операции
 * и выбор варианта (`ChoiceMenu`): там вместо значка — галочка у выбранного.
 */
export function MenuItem({
  icon: Icon,
  checked,
  danger,
  disabled,
  hint,
  title,
  onClick,
  children,
}: {
  icon?: LucideIcon;
  /**
   * Пункт выбора варианта: `true` — выбран (галочка), `false` — нет (пустое
   * место под галочку, чтобы подписи стояли ровно).
   */
  checked?: boolean;
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
      role={checked === undefined ? undefined : "menuitemradio"}
      aria-checked={checked}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={clsx(
        "w-full text-left px-2.5 py-1.5 rounded-md flex items-center gap-2 hover:bg-panel2 disabled:opacity-40 disabled:pointer-events-none",
        danger && "text-expense"
      )}
    >
      {checked !== undefined ? (
        <Check className={clsx("w-4 h-4 shrink-0 text-accent", !checked && "invisible")} aria-hidden />
      ) : (
        Icon && <Icon className="w-4 h-4 shrink-0" />
      )}
      <span className="flex-1 min-w-0 truncate">{children}</span>
      {hint && <span className="shrink-0 text-muted tabular-nums">{hint}</span>}
    </button>
  );
}
