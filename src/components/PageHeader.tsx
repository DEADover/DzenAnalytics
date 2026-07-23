import type { ComponentType, ReactNode } from "react";

interface Props {
  /**
   * Page title. Always rendered as `<h1>`.
   */
  title: string;
  /**
   * Optional Lucide icon (or any component that accepts `className`).
   * When present, renders alongside the title; the icon is the
   * page's identity-tag at-a-glance.
   */
  icon?: ComponentType<{ className?: string }>;
  /**
   * Icon colour class. Defaults to the accent; pass e.g. `text-warn` for
   * attention pages (Аномалии, Дубликаты) so the icon keeps its semantics.
   */
  iconTone?: string;
  /**
   * Short subtitle / hint text shown under the title in muted style.
   */
  hint?: ReactNode;
  /**
   * Optional right-aligned slot for page-level actions
   * (e.g. "Снимок PNG", "Экспорт", year selector). The header arranges
   * itself with `flex items-end justify-between flex-wrap gap-3` so this
   * stays balanced against the title block on wide viewports and wraps
   * cleanly on narrow ones.
   */
  right?: ReactNode;
  /**
   * Allow the hint to wrap onto multiple lines instead of truncating to one.
   * Off by default (keeps header heights uniform); opt in for pages with a
   * genuinely longer subtitle.
   */
  hintWrap?: boolean;
}

/**
 * Shared page header used by every top-level route.
 *
 * Replaces the ad-hoc `<div><h1><p></div>` block that every page used to
 * inline. Guarantees three things across the product:
 *   1. Same typographic scale (`text-2xl font-bold`) and rhythm
 *      (`text-muted text-sm mt-1` for the hint).
 *   2. Every page can show an identity icon — so navigation feels
 *      consistent regardless of which page you land on.
 *   3. A single, predictable slot for page-level actions on the right.
 */
export function PageHeader({
  title,
  icon: Icon,
  iconTone = "text-accent",
  hint,
  right,
  hintWrap,
}: Props) {
  return (
    <div className="flex items-end justify-between flex-wrap gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          {Icon && <Icon className={`w-6 h-6 shrink-0 ${iconTone}`} />}
          <span className="truncate">{title}</span>
        </h1>
        {hint && (
          // Single-line hint by design: keeps every page header's vertical
          // footprint identical (title row + exactly one hint row). On narrow
          // viewports the text truncates with an ellipsis instead of wrapping
          // to a second line, so the layout below never jumps around. Pages
          // should keep hints short enough that truncation is rare in practice.
          <p
            className={`text-muted text-sm mt-1 ${hintWrap ? "" : "truncate"}`}
            title={typeof hint === "string" ? hint : undefined}
          >
            {hint}
          </p>
        )}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}
