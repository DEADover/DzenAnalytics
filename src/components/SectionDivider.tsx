import type { ReactNode } from "react";

/**
 * Left-aligned section divider: a small uppercase label followed by a hairline
 * that fills the rest of the row, with an optional one-line description below.
 * Used to break a long page into labelled sections (e.g. on «Финансовое
 * здоровье»), so each section carries its own intro instead of one page-level
 * blurb that only fits the first block.
 */
export function SectionDivider({
  label,
  description,
  right,
}: {
  label: string;
  description?: string;
  /** В строке заголовка у правого края — настройка этого блока. */
  right?: ReactNode;
}) {
  return (
    <div className="pt-2">
      <div className="flex items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted shrink-0">
          {label}
        </span>
        <div className="h-px flex-1 bg-border" />
        {right}
      </div>
      {description && (
        <p className="text-xs text-muted mt-2">{description}</p>
      )}
    </div>
  );
}
