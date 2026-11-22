import { useEffect, useRef, type MouseEvent } from "react";
import clsx from "clsx";
import type { SelectGesture } from "../lib/rangeSelection";

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
  /** `gesture` — кликнули ли с Shift: списки так выделяют диапазон. */
  onChange: (next: boolean, gesture: SelectGesture) => void;
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
      // Клик с Shift иначе растянул бы выделение текста по всей странице.
      onMouseDown={(e) => {
        if (e.shiftKey) e.preventDefault();
      }}
      // У чекбокса React строит `change` из клика, поэтому Shift виден здесь.
      onChange={(e) =>
        onChange(e.target.checked, { shift: (e.nativeEvent as globalThis.MouseEvent).shiftKey === true })
      }
      className={clsx(
        "w-4 h-4 shrink-0 align-middle accent-accent cursor-pointer",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className
      )}
    />
  );
}
