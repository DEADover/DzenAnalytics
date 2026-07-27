import type { ReactNode } from "react";

/** One «подпись → значение» line of a tooltip. */
export interface TooltipFact {
  label: string;
  value: string;
}

/**
 * Structured body for a tooltip that explains a number: what it is on top,
 * the figures behind it as an aligned two-column list, and an optional note.
 *
 * Exists because a formula plus three sums written as one sentence — «Формула:
 * (доход − расход) ÷ доход × 100. Средние за последние 6 месяцев: доход
 * 542 149 ₽, расход 428 869 ₽, остаётся 113 279 ₽ в месяц» — is a wall of text
 * you have to parse word by word. Split into rows, the same content is read at
 * a glance, and the numbers line up under each other.
 */
export function TooltipFacts({
  title,
  facts,
  note,
}: {
  /** What is being measured / the formula, in one short line. */
  title?: ReactNode;
  facts?: TooltipFact[];
  /** Caveats and «where to change it» — smaller, under the numbers. */
  note?: ReactNode;
}) {
  return (
    <div className="space-y-2">
      {title != null && <div className="font-medium text-text">{title}</div>}
      {facts && facts.length > 0 && (
        <div className="space-y-0.5">
          {facts.map((f) => (
            <div key={f.label} className="flex items-baseline justify-between gap-5">
              <span className="text-muted whitespace-nowrap">{f.label}</span>
              <span className="tabular-nums whitespace-nowrap">{f.value}</span>
            </div>
          ))}
        </div>
      )}
      {note != null && <div className="text-muted">{note}</div>}
    </div>
  );
}
