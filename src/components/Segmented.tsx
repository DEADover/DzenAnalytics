import clsx from "clsx";
import type { LucideIcon } from "lucide-react";

/**
 * Сегментированный переключатель: несколько взаимоисключающих вариантов в
 * одной пилюле. Тот же вид, что у «Таблица / Карточки» на «Счетах», — вынесен
 * отдельно, потому что в настройках таких рядов стало несколько.
 *
 * Набран в том же премиум-ключе, что и остальной интерфейс: дорожка-пилюля с
 * подложкой и кантом, выбранный вариант — своей пилюлей с мягкой тенью. Прежде
 * это был плоский прямоугольник со скруглением в 8 пикселей и мелким текстом
 * в 12 — на странице он читался как служебная мелочь, хотя переключает
 * содержимое целиком.
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
  options: { value: T; label: string; title?: string; icon?: LucideIcon }[];
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
        "inline-flex items-center gap-0.5 rounded-full p-1 bg-panel2 border border-border shadow-tray",
        className
      )}
    >
      {options.map((o) => {
        const active = value === o.value;
        const Icon = o.icon;
        return (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            title={o.title}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-full whitespace-nowrap font-medium",
              "transition-colors duration-200",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
              size === "sm" ? "px-3 py-1 text-[12.5px]" : "px-3.5 py-1.5 text-[13.5px]",
              active
                ? "bg-accent text-accent-fg shadow-[0_6px_16px_-8px_rgb(var(--c-accent))]"
                : "text-muted hover:text-text hover:bg-panel/70"
            )}
          >
            {Icon && <Icon className={size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4"} aria-hidden="true" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
