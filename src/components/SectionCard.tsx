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

/**
 * Ячейка сводки: подпись, крупное число, уточнение.
 *
 * Одинаковые ряды чисел стояли на страницах разным кеглем и даже разным
 * шрифтом — на «Дайджесте» они были моноширинными с подтянутыми пробелами, а
 * на «Годе в цифрах» обычными. Одно и то же число в двух местах продукта
 * выглядело как два разных показателя.
 */
export function StatCell({
  label,
  value,
  note,
  noteCls,
  icon,
  /** Отступ слева от вертикальной черты — у всех ячеек ряда, кроме первой. */
  pad,
}: {
  label: string;
  value: string;
  note?: string;
  noteCls?: string;
  icon?: ReactNode;
  pad?: boolean;
}) {
  return (
    <div className={pad ? "lg:pl-4" : undefined}>
      <div className="flex items-center gap-2 mb-0.5">
        {icon}
        <div className="label">{label}</div>
      </div>
      <div className="stat-num text-2xl xl:text-[28px] font-bold tabular-nums leading-tight">
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
