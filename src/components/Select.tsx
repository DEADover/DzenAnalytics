import { useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import clsx from "clsx";

/**
 * Пикер в стиле остальных полей сервиса: строка `.input` с текущим значением и
 * раскрывающийся список. Один компонент на вид счёта, срок и начисление
 * процентов — иначе три соседних поля выглядели бы тремя разными элементами.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value)?.label ?? "";
  return (
    <div className={clsx("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="input h-10 flex items-center justify-between gap-2 w-full text-left"
      >
        <span className="truncate text-sm">{current}</span>
        <ChevronDown
          className={clsx(
            "w-4 h-4 text-muted shrink-0 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 z-30 mt-2 border border-border rounded-lg bg-panel p-1 shadow-xl min-w-max"
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={clsx(
                "w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-sm text-left whitespace-nowrap",
                o.value === value ? "bg-accent/10 text-accent" : "text-text hover:bg-panel2"
              )}
            >
              <span>{o.label}</span>
              {o.value === value && <Check className="w-3.5 h-3.5 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
