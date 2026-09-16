import clsx from "clsx";
import type { ReactNode } from "react";

export interface Fact {
  label: string;
  value: ReactNode;
  /** Главная строка сводки — значение жирнее. */
  strong?: boolean;
  tone?: "warn" | "expense" | "income";
}

const TONE: Record<NonNullable<Fact["tone"]>, string> = {
  warn: "text-warn",
  expense: "text-expense",
  income: "text-income",
};

/**
 * Сводка «подпись — значение» в окне: что получится, прежде чем нажать
 * главную кнопку. Значения справа, цифры моноширинные — столбец читается
 * сверху вниз, как чек.
 */
export function FactList({ facts, className }: { facts: readonly Fact[]; className?: string }) {
  return (
    <dl className={clsx("rounded-xl border border-border bg-panel2/30 px-4 py-3 space-y-1.5", className)}>
      {facts.map((f) => (
        <div key={f.label} className="flex items-baseline justify-between gap-4">
          <dt className="text-muted">{f.label}</dt>
          <dd
            className={clsx(
              "tabular-nums text-right min-w-0 truncate",
              f.strong && "font-medium text-text",
              f.tone && TONE[f.tone]
            )}
          >
            {f.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
