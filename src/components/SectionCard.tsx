import type { ReactNode } from "react";
import { InfoPopover } from "./InfoPopover";

/**
 * Карточка раздела: значок, заголовок, знак вопроса и содержимое.
 *
 * Каждая страница верстала эту шапку по-своему — где-то `mb-2`, где-то `mb-3`,
 * где-то с поясняющей строкой под названием, где-то без. Один компонент держит
 * их в строю, а объяснение «как это считается» уводит под знак вопроса: текст,
 * который читают один раз, не должен занимать высоту постоянно.
 */
export function SectionCard({
  icon,
  title,
  info,
  right,
  children,
  className,
}: {
  icon: ReactNode;
  title: string;
  /** Как это считается — под знаком вопроса рядом с заголовком. */
  info?: ReactNode;
  /** Правый угол шапки: переключатель, легенда, счётчик. */
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`card-tray px-4 py-3 flex flex-col ${className ?? ""}`}>
      <div className="flex items-center gap-1.5 mb-2.5">
        {icon}
        <span className="font-semibold truncate">{title}</span>
        {info && <InfoPopover>{info}</InfoPopover>}
        {right && <div className="ml-auto shrink-0">{right}</div>}
      </div>
      {children}
    </div>
  );
}

/** Смысловой цвет числа — тот же набор, что у плитки `Stat`. */
export type StatTone = "default" | "income" | "expense" | "warn" | "accent" | "accent2";

const STAT_TONE: Record<StatTone, string> = {
  default: "text-text",
  income: "text-income",
  expense: "text-expense",
  warn: "text-warn",
  accent: "text-accent",
  accent2: "text-accent2",
};

/**
 * Ячейка сводки: подпись, крупное число, уточнение.
 *
 * Вид один в один с плиткой `Stat` со страницы «Операции»: подпись слева,
 * значок СЕРЫЙ и справа, цвет несёт само число. Значок цветом дублировал то,
 * что и так сказано числом, и при этом перетягивал взгляд на себя — в ряду из
 * пяти ячеек первым читался хоровод разноцветных иконок, а не суммы.
 *
 * Отдельно от `Stat`, потому что та рисует себе карточку с двойным кантом, а
 * ряд итогов держит несколько ячеек в ОДНОЙ карточке, разделяя их волосяными
 * чертами. Начинка при этом обязана совпадать.
 */
export function StatCell({
  label,
  value,
  note,
  noteCls,
  icon,
  tone = "default",
  /** Отступ слева от вертикальной черты — у всех ячеек ряда, кроме первой. */
  pad,
}: {
  label: string;
  value: string;
  note?: string;
  noteCls?: string;
  icon?: ReactNode;
  tone?: StatTone;
  pad?: boolean;
}) {
  return (
    <div className={pad ? "lg:pl-4" : undefined}>
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <div className="label">{label}</div>
        {icon && <div className="text-muted shrink-0">{icon}</div>}
      </div>
      <div
        className={`stat-num text-2xl xl:text-[28px] font-bold tabular-nums leading-tight ${STAT_TONE[tone]}`}
      >
        {value}
      </div>
      {note && <div className={`text-xs mt-0.5 ${noteCls || "text-muted"}`}>{note}</div>}
    </div>
  );
}

/**
 * Ряд ячеек сводки — вертикальные черты между ними и общая колонка.
 *
 * Отдельным компонентом, потому что сетку с `divide-x` легко собрать не так:
 * первая ячейка не должна получать отступ слева, а на узком экране черты надо
 * убирать, иначе они режут строку посередине.
 */
export function StatRow({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-4 divide-border lg:divide-x">
      {children}
    </div>
  );
}
