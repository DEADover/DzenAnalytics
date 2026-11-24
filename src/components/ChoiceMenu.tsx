import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import clsx from "clsx";
import { Popover } from "./Popover";
import { MenuItem } from "./MenuItem";

export interface ChoiceOption<T> {
  value: T;
  label: string;
  /** Подсказка к варианту при наведении. */
  title?: string;
}

/**
 * Выбор варианта одной кнопкой: на кнопке — выбранный вариант, по клику —
 * список с галочкой у текущего.
 *
 * Для режимов виджетов на главной. Ряд кнопок-вариантов в шапке карточки в
 * треть ширины не помещался рядом с заголовком и ссылкой, а одна кнопка
 * занимает место одного слова. Геометрия — как у ссылки в шапке (`.pill-link`):
 * стоят рядом и должны быть одной высоты.
 */
export function ChoiceMenu<T extends string | number>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: readonly ChoiceOption<T>[];
  onChange: (next: T) => void;
  /** Что выбирается — для скринридера: «Период капитала: Год». */
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];

  return (
    <div ref={anchorRef} className={clsx("inline-flex shrink-0", className)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${current?.label ?? ""}`}
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          "inline-flex items-center gap-1 rounded-control-sm border border-border bg-panel2/60",
          // Высота — как у ссылки в шапке (`.pill-link`): стоят в одном ряду.
          "h-[34px] px-2.5 text-[12.5px] font-medium normal-case tracking-normal whitespace-nowrap",
          "transition-colors duration-150 hover:border-accent/50 hover:bg-panel2",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
          open && "border-accent/50 bg-panel2"
        )}
      >
        {current?.label}
        <ChevronDown
          className={clsx("w-3.5 h-3.5 text-muted transition-transform duration-150", open && "rotate-180")}
          aria-hidden
        />
      </button>
      <Popover
        open={open}
        anchorRef={anchorRef}
        onClose={() => setOpen(false)}
        align="right"
        className="card p-1 w-max min-w-[9rem] text-[13px] normal-case tracking-normal font-normal"
      >
        <div role="menu" aria-label={label}>
          {options.map((o) => (
            <MenuItem
              key={String(o.value)}
              checked={o.value === value}
              title={o.title}
              onClick={() => {
                setOpen(false);
                if (o.value !== value) onChange(o.value);
              }}
            >
              {o.label}
            </MenuItem>
          ))}
        </div>
      </Popover>
    </div>
  );
}
