import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import { formatNum } from "../lib/format";

/** Тон выбранного варианта: цвет, когда он несёт смысл (тип операции). */
export type SegmentedTone = "accent" | "expense" | "income" | "accent2" | "warn" | "muted";

/** Имена классов целиком: собранные строкой, они выпали бы из сборки CSS. */
const TONE_CLASS: Record<SegmentedTone, string | undefined> = {
  accent: undefined,
  expense: "seg-tone-expense",
  income: "seg-tone-income",
  accent2: "seg-tone-accent2",
  warn: "seg-tone-warn",
  muted: "seg-tone-muted",
};

export interface SegmentedOption<T> {
  value: T;
  label: string;
  title?: string;
  icon?: LucideIcon;
  /** Число рядом с подписью: сколько записей за вкладкой. */
  count?: number;
  /** Вариант есть, но выбрать его нельзя — например, за ним пусто. */
  disabled?: boolean;
  tone?: SegmentedTone;
  /** Зелёная точка «включено» с этой подсказкой — активный источник данных. */
  dot?: string;
}

/**
 * Сегментированный переключатель: несколько взаимоисключающих вариантов в
 * одной пилюле. Единственный на весь продукт — разделы настроек, вкладки
 * страниц, разрезы графиков, пресеты периода и тип операции в карточке
 * собраны из него, а вид живёт в классах `.seg-*` (`index.css`).
 *
 * Прежде дорожек-копий было два десятка, и каждая разошлась с соседями то
 * высотой, то кеглем, то свечением выбранного.
 */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  size = "md",
  tight = false,
  block = false,
  tabs = false,
  className,
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (next: T) => void;
  /** Для скринридера: что выбирает эта группа. */
  label: string;
  /**
   * Ступень высоты. `md` 42 — ряд контролов раздела; `sm` 34 — шапка
   * карточки, строки настроек и формы.
   */
  size?: "sm" | "md";
  /**
   * Плотный набор для рядов из шести-семи коротких вариантов (пресеты
   * периода): поля уже, начертание обычное. Высота — как у `sm`.
   */
  tight?: boolean;
  /** Во всю ширину, варианты делят её поровну — в полях формы. */
  block?: boolean;
  /**
   * Переключает содержимое ниже, как вкладки. Для скринридера это `tablist`,
   * а не группа кнопок-переключателей.
   */
  tabs?: boolean;
  /** Отступы и перенос ряда — со стороны страницы. */
  className?: string;
}) {
  const small = size === "sm" || tight;
  return (
    <div
      role={tabs ? "tablist" : "group"}
      aria-label={label}
      className={clsx(
        "seg-track",
        // На телефоне дорожка не шире своего ряда и листается внутри себя без
        // полосы: семь пресетов периода, четыре режима отправки или три разреза
        // топа иначе растягивали страницу за экран. От `sm` — как было: там
        // прокрутка подрезала бы свечение выбранного варианта.
        "max-sm:max-w-full max-sm:scroll-soft-x",
        block && "flex w-full",
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
            role={tabs ? "tab" : undefined}
            aria-selected={tabs ? active : undefined}
            aria-pressed={tabs ? undefined : active}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            title={o.title}
            className={clsx(
              "seg-item",
              small ? "seg-item-sm" : "seg-item-md",
              tight && "seg-item-tight",
              block && "flex-1 min-w-0",
              active && "seg-on",
              active && o.tone && TONE_CLASS[o.tone]
            )}
          >
            {Icon && (
              <Icon className={clsx("shrink-0", small ? "w-3.5 h-3.5" : "w-4 h-4")} aria-hidden="true" />
            )}
            {o.label}
            {o.count !== undefined && <span className="seg-count">{formatNum(o.count)}</span>}
            {o.dot && <span className="seg-dot" title={o.dot} aria-label={o.dot} role="img" />}
          </button>
        );
      })}
    </div>
  );
}
