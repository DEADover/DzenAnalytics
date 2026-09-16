import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { ArrowUpRight } from "lucide-react";

/**
 * Высота кнопки: `sm` — 42 (ступень ряда контролов), `md` — 44 (на утопленной
 * подложке главной), `lg` — 52 (открытая сводка месяца).
 */
type Size = "sm" | "md" | "lg";

const SIZE: Record<Size, { primary: string; secondary: string; plate: string; icon: string; radius: string }> = {
  sm: {
    primary: "h-[42px] pl-5 pr-1.5 text-[13.5px]",
    secondary: "h-[42px] px-5 text-[13.5px]",
    plate: "w-[30px] h-[30px]",
    icon: "w-3.5 h-3.5",
    // 42 — ещё обычная ступень, радиус как у кнопок рядом.
    radius: "rounded-control",
  },
  md: {
    primary: "h-[44px] pl-5 pr-2 text-[13.5px]",
    secondary: "h-[44px] px-5 text-[13.5px]",
    plate: "w-7 h-7",
    icon: "w-3.5 h-3.5",
    radius: "btn-cta",
  },
  lg: {
    primary: "h-[52px] pl-6 pr-2.5 text-[14px]",
    secondary: "h-[52px] px-6 text-[14px]",
    plate: "w-8 h-8",
    icon: "w-4 h-4",
    radius: "btn-cta",
  },
};

/**
 * Крупная кнопка-призыв на главной: «Лента операций ↗» и «Месячный отчёт».
 *
 * Прежде эта пара была набрана прямо в разметке сводки дважды — в
 * развороте и в колонке — в трёх размерах, и у каждой копии свои числа.
 * Скругление и размеры теперь здесь; радиус — из шкалы контролов
 * (`rounded-control*` в tailwind.config.js).
 *
 * `primary` — залита цветом текста и несёт стрелку в своей плашке: стрелка
 * чуть сдвигается вверх-вправо под курсором. `secondary` — подложкой и кантом.
 * `onPlate` — кнопка стоит на утопленной подложке, где обычная заливка
 * `panel2` почти не отличается от фона: там она белая.
 */
export function CtaLink({
  to,
  children,
  variant = "primary",
  size = "sm",
  onPlate = false,
}: {
  to: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
  size?: Size;
  onPlate?: boolean;
}) {
  const s = SIZE[size];

  if (variant === "secondary") {
    return (
      <Link
        to={to}
        className={clsx(
          "inline-flex items-center border border-border text-text font-medium transition-colors duration-200 hover:border-accent/50",
          s.radius,
          s.secondary,
          onPlate ? "bg-panel hover:bg-panel/70" : "bg-panel2 hover:bg-panel2/70"
        )}
      >
        {children}
      </Link>
    );
  }

  return (
    <Link
      to={to}
      className={clsx("group inline-flex items-center gap-3 bg-text text-panel font-medium", s.radius, s.primary)}
    >
      {children}
      <span
        className={clsx(
          s.plate,
          "rounded-control-sm bg-panel/20 grid place-items-center transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none"
        )}
      >
        <ArrowUpRight className={s.icon} aria-hidden="true" />
      </span>
    </Link>
  );
}
