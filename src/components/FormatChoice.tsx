import type { LucideIcon } from "lucide-react";
import clsx from "clsx";

export interface FormatOption<T extends string> {
  value: T;
  label: string;
  icon: LucideIcon;
  /** Что окажется в файле — одной фразой под названием формата. */
  what: string;
}

/**
 * Выбор формата выгрузки карточками: значок, название и что будет в файле.
 * Один на все окна «Скачать» — годовой отчёт бюджета, отчёт «Дайджеста».
 */
export function FormatChoice<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: readonly FormatOption<T>[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <div className="label mb-2">Формат</div>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Формат">
        {options.map((f) => (
          <button
            key={f.value}
            type="button"
            role="radio"
            aria-checked={f.value === value}
            onClick={() => onChange(f.value)}
            disabled={disabled}
            className={clsx(
              "rounded-xl border p-3 text-left transition-colors disabled:opacity-60",
              f.value === value ? "border-accent bg-accent/5" : "border-border hover:bg-panel2"
            )}
          >
            <span className={clsx("flex items-center gap-2 font-medium", f.value === value ? "text-accent" : "text-text")}>
              <f.icon className="w-4 h-4 shrink-0" />
              {f.label}
            </span>
            <span className="block text-xs text-muted mt-1.5">{f.what}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
