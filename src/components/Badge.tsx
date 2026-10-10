import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import clsx from "clsx";

export type BadgeTone = "neutral" | "accent" | "accent2" | "income" | "expense" | "warn";

/** Фон — тон на 15 %, у акцента на 10: он ярче остальных и на 15 кричит. */
const TONE: Record<BadgeTone, string> = {
  neutral: "bg-panel2 text-muted",
  accent: "bg-accent/10 text-accent",
  accent2: "bg-accent2/15 text-accent2",
  income: "bg-income/15 text-income",
  expense: "bg-expense/15 text-expense",
  warn: "bg-warn/15 text-warn",
};

/** Сплошная заливка — метка, которая должна читаться поверх светлых полей. */
const SOLID: Record<BadgeTone, string> = {
  neutral: "bg-muted text-on-tone",
  accent: "bg-accent text-on-tone",
  accent2: "bg-accent2 text-on-tone",
  income: "bg-income text-on-tone",
  expense: "bg-expense text-on-tone",
  warn: "bg-warn text-on-tone",
};

/**
 * Метка состояния: короткое слово с заглавной буквы в пилюле цвета смысла —
 * «Новая», «Удалена», «Изменён», «Архив», «Профицит», «92%».
 *
 * Прежде метки набирали по месту: 10, 11 и 12 px, капсом и строчными, со
 * скруглением 4, 6 и в пилюлю, с кантом и без, фон тона на 10 и на 15 %.
 * Одно и то же «новый» в двух соседних справочниках выглядело по-разному.
 */
export function Badge({
  tone = "neutral",
  size = "sm",
  solid = false,
  icon: Icon,
  title,
  className,
  children,
}: {
  tone?: BadgeTone;
  /** `xs` 10 px — в строке ярлыка поля (ниже самого ярлыка, строку не
   *  раздвигает); `sm` 12 px — в строке списка; `md` 14 px — рядом с крупным итогом. */
  size?: "xs" | "sm" | "md";
  /** Сплошная заливка тоном вместо подложки — когда метка стоит рядом с
   *  такими же светлыми полями и иначе с ними сливается. */
  solid?: boolean;
  icon?: LucideIcon;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={clsx(
        "inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap",
        size === "xs"
          ? "px-1.5 text-[10px] leading-[14px]"
          : size === "sm"
            ? "px-2 py-0.5 text-xs leading-4"
            : "px-3 py-1 text-sm",
        solid ? SOLID[tone] : TONE[tone],
        className
      )}
    >
      {Icon && <Icon className={clsx("shrink-0", size === "md" ? "w-3.5 h-3.5" : "w-3 h-3")} aria-hidden="true" />}
      {children}
    </span>
  );
}
