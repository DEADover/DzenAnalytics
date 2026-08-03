import clsx from "clsx";

/**
 * Сегментированный переключатель: несколько взаимоисключающих вариантов в
 * одной пилюле. Тот же вид, что у «Таблица / Карточки» на «Счетах», — вынесен
 * отдельно, потому что в настройках таких рядов стало несколько.
 */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  size = "md",
  className,
}: {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (next: T) => void;
  /** Для скринридера: что выбирает эта группа. */
  label: string;
  /** `sm` — плотный вариант для рядов с шестью и более вариантами: при обычном
   *  размере такой ряд не влезает на узкий экран и выдавливает соседей. */
  size?: "sm" | "md";
  /** Для случаев, когда ряд должен переноситься или занимать всю ширину. */
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={clsx(
        "inline-flex bg-panel2 rounded-lg p-1 border border-border",
        className
      )}
    >
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          title={o.title}
          className={clsx(
            "rounded-md whitespace-nowrap transition-colors",
            size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1 text-sm",
            value === o.value
              ? "bg-accent text-accent-fg"
              : "text-muted hover:text-text"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
