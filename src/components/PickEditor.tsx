import clsx from "clsx";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * Части окон «собери свой набор»: основное меню (`HeaderNavModal`) и быстрые
 * настройки (`QuickSettingsModal`). Слева — то, что уже в наборе, в акцентной
 * половине; справа — всё остальное. Одни детали на оба окна, чтобы они
 * выглядели и вели себя одинаково.
 */

/** Шапка половины окна: значок, название и то, где эти пункты окажутся. */
export function PickHalfHeader({
  icon: Icon,
  title,
  hint,
  accent = false,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 px-1 mb-3">
      <Icon className={clsx("w-4 h-4 shrink-0", accent ? "text-accent" : "text-muted")} aria-hidden />
      <h3 className="text-sm font-semibold">{title}</h3>
      <span className="text-xs text-muted">· {hint}</span>
    </div>
  );
}

/** Строка пункта: значок, название, пояснение и кнопки справа. */
export function PickRow({
  icon: Icon,
  label,
  hint,
  framed = false,
  children,
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
  /** Строка набора — в рамке: это то, что собирают. */
  framed?: boolean;
  children: ReactNode;
}) {
  return (
    <li
      className={clsx(
        "flex items-center gap-3 px-2.5 py-1.5 rounded-xl",
        framed ? "border border-border bg-panel shadow-sm" : "hover:bg-panel"
      )}
    >
      <Icon className="w-4 h-4 shrink-0 text-muted" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{label}</span>
        <span className="block truncate text-xs text-muted">{hint}</span>
      </span>
      <span className="shrink-0 flex items-center gap-0.5">{children}</span>
    </li>
  );
}
