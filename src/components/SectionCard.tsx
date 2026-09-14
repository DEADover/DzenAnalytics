import { Children, createContext, isValidElement, useContext, type ReactNode } from "react";
import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import { CardHeader, type CardHeaderTone } from "./CardHeader";
import { Tooltip } from "./Tooltip";

/**
 * Карточка раздела: шапка (`CardHeader`) и содержимое.
 *
 * Каждая страница верстала эту шапку по-своему — где-то `mb-2`, где-то `mb-3`,
 * где-то с поясняющей строкой под названием, где-то без. Шапка общая с
 * таблицами (`DataTable`), а объяснение «как это считается» уходит под знак
 * вопроса: текст, который читают один раз, не должен занимать высоту
 * постоянно.
 */
export function SectionCard({
  icon,
  tone,
  title,
  subtitle,
  info,
  right,
  children,
  className,
}: {
  icon: LucideIcon;
  tone?: CardHeaderTone;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Как это считается — под знаком вопроса рядом с заголовком. */
  info?: ReactNode;
  /** Правый угол шапки: переключатель, легенда, счётчик. */
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("card-tray px-4 py-3 flex flex-col", className)}>
      <CardHeader icon={icon} tone={tone} title={title} subtitle={subtitle} info={info} right={right} />
      {children}
    </div>
  );
}

/** Смысловой цвет числа в ряду итогов. */
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
 * Что ряд итогов сообщает своим ячейкам.
 *
 * `wide` — ячеек шесть: такие числа в 28 px на экране 1280 не помещаются,
 * «+1 487 066 ₽» шире ячейки и залезает на соседнюю.
 *
 * `notesInTooltip` — уточнение под числом есть не у всех ячеек. Тогда оно
 * уходит в подсказку при наведении: одна подпись у одной ячейки из трёх
 * делала весь ряд на строку выше, а у остальных ячеек под числом оставалась
 * пустота.
 */
const StatRowContext = createContext<{ wide: boolean; notesInTooltip: boolean }>({
  wide: false,
  notesInTooltip: false,
});

/** Строка из подсказки стоит отдельно, поэтому начинается с заглавной. */
function capitalizeFirst(node: ReactNode): ReactNode {
  return typeof node === "string" && node.length > 0
    ? node.charAt(0).toUpperCase() + node.slice(1)
    : node;
}

/** Уточнение и пояснение одной подсказкой: уточнение — заголовком. */
function mergeTooltip(note: ReactNode, noteCls: string | undefined, tooltip: ReactNode): ReactNode {
  const head = capitalizeFirst(note);
  if (tooltip == null || tooltip === false || tooltip === "") {
    return noteCls ? <span className={noteCls}>{head}</span> : head;
  }
  // Две строки — и Tooltip сам сделает первую заголовком, вторую пояснением.
  if (typeof head === "string" && typeof tooltip === "string" && !noteCls) {
    return `${head}\n${tooltip}`;
  }
  return (
    <>
      <div className={clsx("font-medium", noteCls)}>{head}</div>
      <div className="text-muted mt-1">{tooltip}</div>
    </>
  );
}

/**
 * Ячейка ряда итогов: подпись, крупное число, уточнение.
 *
 * Подпись слева, значок СЕРЫЙ и справа, цвет несёт само число. Значок цветом
 * дублировал то, что и так сказано числом, и перетягивал взгляд на себя — в
 * ряду из пяти ячеек первым читался хоровод разноцветных иконок, а не суммы.
 *
 * Одна ячейка на весь продукт. Раньше рядом жили отдельные плитки `Stat` с
 * числом 24 / 600 — на двенадцати страницах — и эти ячейки с числом 28 / 700
 * на пяти: одно и то же «итого за период» выглядело двумя разными элементами.
 *
 * Ячейка ничего не делает по нажатию: действие с итогом — отдельная кнопка
 * (в `icon` или в `children`), иначе непонятно, какая из цифр кликается.
 */
export function StatCell({
  label,
  value,
  note,
  noteCls,
  icon,
  tone = "default",
  tooltip,
  children,
}: {
  label: string;
  value: ReactNode;
  /** Уточнение под числом. Продолжает подпись фразой — поэтому со строчной. */
  note?: ReactNode;
  noteCls?: string;
  /** Серый значок справа от подписи — или кнопка-значок действия с итогом. */
  icon?: ReactNode;
  tone?: StatTone;
  /** Как это считается — подсказкой при наведении, а не лишней строкой. */
  tooltip?: ReactNode;
  /** Под уточнением: план, статус, ссылка на действие. */
  children?: ReactNode;
}) {
  const { wide, notesInTooltip } = useContext(StatRowContext);
  const hasNote = note != null && note !== false && note !== "";
  const noteInTooltip = notesInTooltip && hasNote;
  const tip = noteInTooltip ? mergeTooltip(note, noteCls, tooltip) : tooltip;
  const cell = (
    <div className={clsx("min-w-0", tip && "cursor-help")}>
      <div className="flex items-center justify-between gap-2 mb-0.5 min-h-4">
        <div className="label truncate">{label}</div>
        {icon && <div className="text-muted shrink-0 flex items-center">{icon}</div>}
      </div>
      <div
        className={clsx(
          "stat-num font-bold tabular-nums leading-tight truncate",
          wide ? "text-2xl 2xl:text-[28px]" : "text-2xl xl:text-[28px]",
          STAT_TONE[tone]
        )}
      >
        {value}
      </div>
      {/* Уточнение — в одну строку. Перенос делал ячейку выше соседних, а с
          ней и весь ряд; не влезло — многоточие, полный текст в подсказке. */}
      {hasNote && !noteInTooltip && (
        <div
          className={clsx("text-xs mt-0.5 truncate", noteCls || "text-muted")}
          title={typeof note === "string" ? note : undefined}
        >
          {note}
        </div>
      )}
      {children}
    </div>
  );
  return tip ? <Tooltip content={tip}>{cell}</Tooltip> : cell;
}

StatCell.statCell = true;

/**
 * Есть ли у ячейки строка под числом — уточнение или действие.
 *
 * `null` — ячейка обёрнута в свой компонент (итоги «Бюджета»): его подписей
 * отсюда не видно, и такой ряд за строки ячеек отвечает сам.
 */
function noteLineOf(child: ReactNode): boolean | null {
  // По метке, а не по ссылке на функцию: горячая перезагрузка в разработке
  // подменяет компонент, и сравнение `type === StatCell` молча ломалось.
  if (!isValidElement(child) || !(child.type as { statCell?: boolean }).statCell) return null;
  const p = child.props as { note?: ReactNode; children?: ReactNode };
  const hasNote = p.note != null && p.note !== false && p.note !== "";
  const hasExtra = p.children != null && p.children !== false;
  return hasNote || hasExtra;
}

/** Колонки ряда на широком экране — по числу ячеек. */
const ROW_COLS: Record<number, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
  6: "lg:grid-cols-3 xl:grid-cols-6",
};

/**
 * Ряд итогов раздела: ячейки в одной карточке с двойным кантом, между ними
 * волосяные черты.
 *
 * Сетка и черты живут здесь, а не на каждой странице: `divide-x` легко
 * собрать не так — первая ячейка не должна получать отступ слева, а на узком
 * экране, где ячейки идут по две в строку, черты надо убирать, иначе они режут
 * строку посередине. Шесть ячеек до 1280 px стоят двумя строками по три — и
 * тоже без черт.
 */
export function StatRow({ children, className }: { children: ReactNode; className?: string }) {
  const cells = Children.toArray(children);
  const count = cells.length;
  const wide = count >= 6;
  // Строка под числом — у всех ячеек ряда или ни у одной. Если она есть
  // только у части, уточнения уходят в подсказки, и ряд остаётся низким.
  const lines = cells.map(noteLineOf);
  const withLine = lines.filter((l) => l === true).length;
  const notesInTooltip = !lines.includes(null) && withLine > 0 && withLine < count;
  return (
    <div className={clsx("tray", className)}>
      <div className="tray-core px-5 py-4">
        <StatRowContext.Provider value={{ wide, notesInTooltip }}>
          <div
            className={clsx(
              "grid grid-cols-2 gap-x-4 gap-y-4 divide-border",
              ROW_COLS[Math.min(Math.max(count, 1), 6)],
              wide ? "xl:divide-x xl:[&>*+*]:pl-4" : "lg:divide-x lg:[&>*+*]:pl-4"
            )}
          >
            {children}
          </div>
        </StatRowContext.Provider>
      </div>
    </div>
  );
}
