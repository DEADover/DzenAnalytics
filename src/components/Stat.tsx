import clsx from "clsx";
import type { ReactNode } from "react";

interface Props {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "income" | "expense" | "warn";
  icon?: ReactNode;
  /** Compact layout — smaller padding/number, for dense metric rows. */
  dense?: boolean;
}

export function Stat({ label, value, hint, tone = "default", icon, dense }: Props) {
  const toneClass = {
    default: "text-text",
    income: "text-income",
    expense: "text-expense",
    warn: "text-warn",
  }[tone];
  return (
    <div className={clsx("card", dense ? "p-3" : "card-pad")}>
      <div className={clsx("flex items-center justify-between", dense ? "mb-0.5" : "mb-2")}>
        <div className="label">{label}</div>
        {icon && <div className="text-muted">{icon}</div>}
      </div>
      <div
        className={clsx(
          dense ? "text-xl font-semibold tabular-nums" : "stat-num",
          toneClass
        )}
      >
        {value}
      </div>
      {hint && <div className="text-xs text-muted mt-1">{hint}</div>}
    </div>
  );
}
