import { useId, type CSSProperties, type ReactNode } from "react";
import clsx from "clsx";

interface RangeProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (next: number) => void;
  disabled?: boolean;
}

/**
 * Голая дорожка бегунка — для мест, где подпись и значение уже нарисованы
 * вокруг по-своему (строка настройки размера текста). Вид — класс `.range`.
 */
export function RangeInput({
  value,
  min,
  max,
  step = 1,
  onChange,
  disabled,
  id,
  ariaLabel,
  valueText,
  className,
}: RangeProps & {
  id?: string;
  /** Для скринридера, когда видимой подписи рядом нет. */
  ariaLabel?: string;
  /** Значение словами для скринридера: «2,5σ», «3 дн». */
  valueText?: string;
  className?: string;
}) {
  const fill = max > min ? ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100 : 0;
  return (
    <input
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-label={ariaLabel}
      aria-valuetext={valueText}
      className={clsx("range", className)}
      style={{ "--range-fill": `${fill}%` } as CSSProperties}
    />
  );
}

/**
 * Бегунок с подписью и значением — один на продукт.
 *
 * `row` — капсула в ряду контролов: подпись, дорожка и значение в строку, та
 * же дорожка-пилюля, что у переключателей рядом, и та же ступень — 42 в ряду
 * контролов раздела, 34 в компактных рядах. `stacked` — в карточке или форме:
 * подпись и значение над дорожкой во всю ширину, пояснение под ней.
 *
 * Прежде бегунков было шесть, и каждый сверстан по-своему: подпись 12 muted
 * или 14 основного цвета, значение моноширинным акцентом или полужирным, у
 * одного — строчной буквой («топ»). В шапке раздела они стояли без рамки, ниже
 * соседних кнопок, и читались как текст, а не как контрол.
 */
export function Slider({
  label,
  format = String,
  display,
  hint,
  layout = "row",
  size = "md",
  className,
  ...range
}: RangeProps & {
  label: string;
  /** Значение словами: «2,5σ», «3 дн», «+10%». Им же подписан бегунок для скринридера. */
  format?: (v: number) => string;
  /** Своё оформление значения вместо `format` — только в `stacked`. */
  display?: ReactNode;
  /** Строка под дорожкой — только в `stacked`. */
  hint?: ReactNode;
  layout?: "row" | "stacked";
  /** Ступень капсулы в `row`: `md` 42 — ряд контролов раздела, `sm` 34. */
  size?: "sm" | "md";
  className?: string;
}) {
  const id = useId();
  const text = format(range.value);

  if (layout === "stacked") {
    return (
      <div className={className}>
        <div className="flex items-baseline justify-between gap-3 text-sm mb-2">
          <label htmlFor={id}>{label}</label>
          <output htmlFor={id} className="font-semibold tabular-nums text-right">
            {display ?? text}
          </output>
        </div>
        <RangeInput {...range} id={id} valueText={text} className="block w-full" />
        {hint && <div className="text-xs text-muted mt-1">{hint}</div>}
      </div>
    );
  }

  // Ширина значения — по самому длинному из крайних, чтобы при перетаскивании
  // дорожка не ездила, когда «9 дн» становится «14 дн».
  const chars = Math.max(format(range.min).length, format(range.max).length);
  const md = size === "md";
  return (
    <div
      className={clsx(
        "seg-track shrink-0",
        md ? "seg-track-md h-[42px] gap-3 px-4 text-[13.5px] leading-5" : "h-[34px] gap-2.5 px-3 text-[12.5px] leading-4",
        className
      )}
    >
      <label htmlFor={id} className="text-muted font-medium whitespace-nowrap">
        {label}
      </label>
      <RangeInput {...range} id={id} valueText={text} className={md ? "w-24 sm:w-32" : "w-24"} />
      <output
        htmlFor={id}
        className="font-medium tabular-nums text-right whitespace-nowrap"
        style={{ minWidth: `${chars}ch` }}
      >
        {text}
      </output>
    </div>
  );
}
