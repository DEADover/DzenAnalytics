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
}: {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (next: T) => void;
  /** Для скринридера: что выбирает эта группа. */
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex bg-panel2 rounded-lg p-1 border border-border"
    >
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          title={o.title}
          className={clsx(
            "px-3 py-1 text-sm rounded-md whitespace-nowrap transition-colors",
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
