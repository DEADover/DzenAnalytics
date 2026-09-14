import { Search, X } from "lucide-react";
import clsx from "clsx";

/**
 * Поле поиска: лупа слева, крестик «очистить», пока что-то набрано.
 *
 * `field` — обычное поле ступени `sm` 34 или `md` 38 (ряд инструментов над
 * таблицей, окно, страница поиска); `menu` — строка поиска в шапке
 * выпадающего списка, без своей рамки, под ней черта.
 *
 * Прежде поиск верстали десятью способами: поле с отступом под лупу, серая
 * коробка со скруглением 8 и высотой 30, голый ввод в списке — крестик то
 * значком, то символом «✕», то не было вовсе.
 */
export function SearchInput({
  value,
  onChange,
  placeholder,
  variant = "field",
  size = "md",
  autoFocus,
  ariaLabel,
  title,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  variant?: "field" | "menu";
  size?: "sm" | "md";
  autoFocus?: boolean;
  ariaLabel?: string;
  /** Подсказка на всём поле: что именно ищется. */
  title?: string;
  className?: string;
}) {
  const clear = value ? (
    <button
      type="button"
      onClick={() => onChange("")}
      className={clsx(
        "btn-icon btn-icon-sm shrink-0",
        variant === "field" && "absolute right-1.5 top-1/2 -translate-y-1/2"
      )}
      aria-label="Очистить поиск"
    >
      <X className="w-3.5 h-3.5" />
    </button>
  ) : null;

  if (variant === "menu") {
    return (
      <div className={clsx("flex items-center gap-2 px-3 py-1.5 border-b border-border/60", className)} title={title}>
        <Search className="w-3.5 h-3.5 text-muted shrink-0" aria-hidden="true" />
        <input
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={ariaLabel ?? placeholder}
          className={clsx("bg-transparent w-full min-w-0 outline-none py-0.5", size === "sm" ? "text-xs" : "text-sm")}
        />
        {clear}
      </div>
    );
  }

  return (
    <div className={clsx("relative", className)} title={title}>
      <Search
        className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
        aria-hidden="true"
      />
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className={clsx(
          "input pl-9 pr-9",
          size === "sm" ? "h-[34px] text-xs" : "h-[38px] text-sm"
        )}
      />
      {clear}
    </div>
  );
}
