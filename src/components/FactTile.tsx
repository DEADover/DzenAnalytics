import clsx from "clsx";
import type { ReactNode } from "react";

/**
 * Факт: плитка «имя показателя, число, уточнение» — в «Годе в цифрах» и в
 * карточке места в «Контрагентах».
 *
 * Пустота в этом блоке оказалась не свойством плиток, а следствием растяжки.
 * Карточка тянулась по высоте соседней, лишняя высота уходила в плитки, и они
 * распухали: содержимого на две строки, плитка на четыре. Стоило прижать
 * содержимое к ширине — пустота переезжала вниз, и наоборот.
 *
 * Поэтому карточка больше не тянется, а плиток три в ряд, а не две: при ширине
 * в треть карточки подпись, число и уточнение занимают плитку целиком в обе
 * стороны, и добирать высоту нечем — её ровно столько, сколько нужно тексту.
 */
const TONE = { expense: "text-expense", income: "text-income", accent: "text-accent" } as const;

export function FactTile({
  label,
  value,
  sub,
  tone,
  small,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  /** Цвет числа — как у этой суммы в остальном интерфейсе. */
  tone?: keyof typeof TONE;
  /** Плитки в узкой колонке: число на ступень мельче, чтобы сумма влезала целиком. */
  small?: boolean;
}) {
  return (
    <div className="card-sunken px-3 py-2.5 min-w-0">
      <div className="caps-label truncate">
        {label}
      </div>
      <div
        className={clsx(
          "stat-num font-bold tabular-nums leading-tight mt-1 truncate",
          small ? "text-lg" : "text-xl",
          tone && TONE[tone]
        )}
      >
        {value}
      </div>
      {sub && (
        <div className="text-[11px] text-muted leading-tight truncate mt-0.5">{sub}</div>
      )}
    </div>
  );
}
