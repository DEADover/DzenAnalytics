import type { ReactNode } from "react";
import clsx from "clsx";
import { AlertTriangle, Info } from "lucide-react";

/**
 * Пометка в подвале окна слева от кнопок: ошибка отправки (`error`) или то,
 * что мешает сохранить (`warn`). Одна на все окна — раньше одна и та же
 * разметка жила в каждом окне своей копией.
 */
export function FooterNote({ tone, children }: { tone: "error" | "warn"; children: ReactNode }) {
  const Icon = tone === "error" ? AlertTriangle : Info;
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={clsx(
        "inline-flex items-start gap-2 max-w-md rounded-lg px-3 py-2 text-xs border",
        tone === "error" ? "bg-expense/10 text-expense border-expense/30" : "bg-warn/10 text-warn border-warn/30"
      )}
    >
      <Icon className="w-3.5 h-3.5 shrink-0 mt-px" />
      <span>{children}</span>
    </div>
  );
}
