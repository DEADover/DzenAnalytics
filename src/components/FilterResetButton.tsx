import clsx from "clsx";
import { FilterX } from "lucide-react";

/**
 * Сброс фильтров — одна кнопка на весь продукт: у общего фильтра и у
 * фильтров списка внутри раздела («Счета»: тип, банк, признаки). Значок
 * воронки с крестиком; неактивна, пока сбрасывать нечего.
 */
export function FilterResetButton({
  className,
  onReset,
  disabled,
  hint,
  label = "Сбросить все фильтры",
}: {
  className?: string;
  onReset: () => void;
  disabled: boolean;
  /** Подсказка: что сбросится или почему сбрасывать нечего. */
  hint?: string;
  /** Имя кнопки для экранного диктора. */
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onReset}
      disabled={disabled}
      title={hint}
      aria-label={label}
      className={clsx(
        "btn-ghost text-xs px-3 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-panel2",
        className
      )}
    >
      <FilterX className="w-4 h-4" />
    </button>
  );
}
