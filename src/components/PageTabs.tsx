import clsx from "clsx";
import type { LucideIcon } from "lucide-react";

/**
 * Вкладки верхнего уровня внутри страницы: подчёркнутый ряд под заголовком.
 *
 * Такой ряд был на «Настройках», а теперь ещё и на «Счетах», — и оба раза он
 * значит одно и то же: страница делится на самостоятельные разделы, между
 * которыми переключаются, а не пролистывают. Не путать с `Segmented`: тот
 * выбирает ВАРИАНТ показа одного и того же (месяцы/кварталы, карточки/таблица),
 * а вкладки меняют содержимое целиком.
 */
export interface PageTab<T extends string> {
  id: T;
  label: string;
  icon?: LucideIcon;
  /** Подсказка при наведении — чем этот раздел отличается от соседнего. */
  title?: string;
}

export function PageTabs<T extends string>({
  value,
  tabs,
  onChange,
  label,
  className,
}: {
  value: T;
  tabs: readonly PageTab<T>[];
  onChange: (next: T) => void;
  /** Для скринридера: чем управляет этот ряд. */
  label: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={clsx(
        "border-b border-border flex items-center gap-1 overflow-x-auto overflow-y-hidden",
        className
      )}
    >
      {tabs.map((t) => {
        const active = value === t.id;
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            title={t.title}
            onClick={() => onChange(t.id)}
            className={clsx(
              "inline-flex items-center gap-2 px-4 py-2 text-sm font-medium",
              "border-b-2 -mb-px transition-colors whitespace-nowrap",
              active
                ? "border-accent text-text"
                : "border-transparent text-muted hover:text-text"
            )}
          >
            {Icon && <Icon className="w-4 h-4" />}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
