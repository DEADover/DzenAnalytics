import type { CSSProperties } from "react";
import clsx from "clsx";

const FILL = {
  accent: "bg-accent",
  accent2: "bg-accent2",
  income: "bg-income",
  expense: "bg-expense",
  warn: "bg-warn",
} as const;

/**
 * Шкала показателя: дорожка 6 px цвета `panel2`, заливка цветом состояния.
 *
 * Прежде полос было дюжина копий, и у каждой своя толщина — 4, 6, 8 и 10 px,
 * — своя дорожка (`panel2`, `border`, `border/60`, `border/70`) и то
 * скруглённый конец заливки, то рубленый. Рядом на одной странице (главная,
 * «Здоровье») они читались как разные элементы.
 *
 * Составные полосы со своей логикой — бюджет с засечкой «сегодня» и
 * опережением, пропорции частей в разделении — остаются своими.
 */
export function ProgressBar({
  value,
  tone = "accent",
  fillClassName,
  fillStyle,
  label,
  className,
}: {
  /** Доля от 0 до 1; лишнее обрезается. */
  value: number;
  tone?: keyof typeof FILL;
  /** Цвет заливки, если он уже вычислен классом (статус показателя). */
  fillClassName?: string;
  /** Например, прозрачность заливки по величине. */
  fillStyle?: CSSProperties;
  /** Подпись для скринридера. Без неё полоса — оформление рядом с числом. */
  label?: string;
  className?: string;
}) {
  const ratio = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  return (
    <div
      className={clsx("h-1.5 rounded-full bg-panel2 overflow-hidden", className)}
      {...(label
        ? {
            role: "progressbar",
            "aria-label": label,
            "aria-valuemin": 0,
            "aria-valuemax": 100,
            "aria-valuenow": Math.round(ratio * 100),
          }
        : { "aria-hidden": true })}
    >
      <div
        className={clsx("h-full rounded-full transition-[width] duration-500", fillClassName ?? FILL[tone])}
        style={{ width: `${ratio * 100}%`, ...fillStyle }}
      />
    </div>
  );
}
