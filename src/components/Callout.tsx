import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, type LucideIcon } from "lucide-react";
import clsx from "clsx";

export type CalloutTone = "accent" | "accent2" | "income" | "warn" | "expense";

/** Имена классов целиком: собранные строкой, они выпали бы из сборки CSS. */
const TONE: Record<CalloutTone, { box: string; icon: string }> = {
  accent: { box: "bg-accent/5 border-accent/40", icon: "text-accent" },
  accent2: { box: "bg-accent2/5 border-accent2/40", icon: "text-accent2" },
  income: { box: "bg-income/5 border-income/40", icon: "text-income" },
  warn: { box: "bg-warn/5 border-warn/40", icon: "text-warn" },
  expense: { box: "bg-expense/5 border-expense/40", icon: "text-expense" },
};

const DEFAULT_ICON: Record<CalloutTone, LucideIcon> = {
  accent: Info,
  accent2: Info,
  income: CheckCircle2,
  warn: AlertTriangle,
  expense: AlertTriangle,
};

/**
 * Пояснение или предупреждение в рамке цвета смысла: значок 16, текст,
 * названия — полужирным, переход — ссылкой.
 *
 * `banner` — отдельным блоком в потоке страницы (радиус 18, как у карточек,
 * текст 14 приглушённый); `note` — внутри карточки, окна или строки таблицы
 * (радиус 12, текст 12).
 *
 * Прежде таких рамок было больше десятка, и у каждой свои: радиус 4, 6, 8,
 * 12 и 18, фон тона на 5 и на 10 %, кант на 30 и на 40 %, поля 8, 10 и 12,
 * а текст то цвета тона, то обычный.
 */
export function Callout({
  tone = "accent",
  size = "note",
  icon,
  className,
  children,
}: {
  tone?: CalloutTone;
  size?: "banner" | "note";
  /** Свой значок; `null` — без значка, когда внутри уже есть свои кнопки и поля. */
  icon?: LucideIcon | null;
  className?: string;
  children: ReactNode;
}) {
  const Icon = icon === undefined ? DEFAULT_ICON[tone] : icon;
  return (
    <div
      className={clsx(
        "flex items-start border",
        size === "banner" ? "gap-3 rounded-[18px] px-5 py-4 text-sm" : "gap-2 rounded-xl p-3 text-xs",
        TONE[tone].box,
        className
      )}
    >
      {Icon && <Icon className={clsx("w-4 h-4 shrink-0 mt-0.5", TONE[tone].icon)} aria-hidden="true" />}
      <div className={clsx("min-w-0 flex-1", size === "banner" && "text-muted")}>{children}</div>
    </div>
  );
}
