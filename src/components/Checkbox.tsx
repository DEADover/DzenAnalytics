import { useEffect, useRef, type MouseEvent } from "react";
import clsx from "clsx";

/**
 * Чекбокс продукта: 16 px, цвет акцента.
 *
 * Отдельным компонентом, потому что родной чекбокс разошёлся по размерам (13,
 * 14 и 16 px), а часть копий красилась переменной, которой нет, — и браузер
 * рисовал их системным синим. Плюс «частично выбрано» у родного чекбокса
 * ставится только из кода, и эта строчка повторялась в каждой таблице.
 */
export function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  label,
  title,
  disabled,
  className,
  stopPropagation = false,
}: {
  checked: boolean;
  /** «Выбрано не всё»: черта вместо галочки. */
  indeterminate?: boolean;
  onChange: (next: boolean) => void;
  /** Для скринридера — что выбирает этот чекбокс. */
  label: string;
  title?: string;
  disabled?: boolean;
  className?: string;
  /** Не пускать клик в строку таблицы, у которой свой обработчик. */
  stopPropagation?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      title={title}
      onClick={stopPropagation ? (e: MouseEvent) => e.stopPropagation() : undefined}
      onChange={(e) => onChange(e.target.checked)}
      className={clsx(
        "w-4 h-4 shrink-0 align-middle accent-accent cursor-pointer",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className
      )}
    />
  );
}
