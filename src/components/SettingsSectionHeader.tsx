import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import clsx from "clsx";

interface Props {
  icon: LucideIcon;
  title: ReactNode;
  /** Icon tint — sections default to accent2, a few use accent/warn. */
  iconTone?: string;
  /** Controls pinned to the right of the header (segmented switch, buttons…). */
  right?: ReactNode;
  className?: string;
}

/**
 * Header row of a Settings section card — icon + title, with an optional
 * right-hand control slot.
 *
 * The row keeps a fixed minimum height (`min-h-10`, the height of the buttons
 * some sections put on the right). Without it a section WITH buttons rendered a
 * ~40px header while one WITHOUT them rendered a ~24px header, so the title
 * visibly jumped up and down as you flipped through the Settings tabs.
 */
export function SettingsSectionHeader({
  icon: Icon,
  title,
  iconTone = "text-accent2",
  right,
  className,
}: Props) {
  return (
    <div
      className={clsx(
        "flex items-center justify-between gap-3 flex-wrap min-h-10",
        className
      )}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <Icon className={clsx("w-5 h-5 shrink-0", iconTone)} />
        <span className="font-medium text-text">{title}</span>
      </div>
      {right}
    </div>
  );
}
