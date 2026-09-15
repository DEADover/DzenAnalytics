import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, type LucideIcon } from "lucide-react";
import { Popover } from "./Popover";

export interface SortOption<V extends string> {
  value: V;
  /** «Дата ↓», «Сумма ↑». */
  label: string;
  /** Значок поля — по нему на кнопке видно, по чему отсортировано. */
  icon: LucideIcon;
  dir: "asc" | "desc";
}

/**
 * Компактная сортировка ленты: кнопка-значок (поле и стрелка направления) и
 * меню с названными вариантами.
 *
 * Одна на ленту «Операций» и «Удалённые».
 */
export function SortMenu<V extends string>({
  options,
  value,
  onChange,
  onOpenChange,
}: {
  options: SortOption<V>[];
  value: V;
  onChange: (value: V) => void;
  /** Открыто ли меню — странице, которой Escape нужен для своего (снять выделение). */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpenState] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  const active = options.find((o) => o.value === value) ?? options[0];
  const FieldIcon = active.icon;
  const DirIcon = active.dir === "desc" ? ArrowDown : ArrowUp;

  return (
    <div ref={anchorRef} className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className="btn-ghost text-xs !px-2.5 h-[34px]"
        title={`Сортировка: ${active.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <FieldIcon className="w-3.5 h-3.5" />
        <DirIcon className="w-3 h-3" />
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>
      {/* Ширина — по самой длинной подписи, но не уже 7rem: при жёстких 7rem
          «Удалена ↓» в «Удалённых» обрезалась многоточием. */}
      <Popover
        open={open}
        anchorRef={anchorRef}
        onClose={() => setOpen(false)}
        align="left"
        className="w-max min-w-28 card p-2"
      >
        {options.map((o) => {
          const Icon = o.icon;
          return (
            <button
              key={o.value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded hover:bg-panel2 ${
                value === o.value ? "bg-panel2 text-accent2 font-medium" : ""
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span className="flex-1 whitespace-nowrap">{o.label}</span>
            </button>
          );
        })}
      </Popover>
    </div>
  );
}
