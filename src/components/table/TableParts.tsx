/**
 * Детали таблицы — одни на весь продукт.
 *
 * Их берёт `DataTable`, и их же берут таблицы со сложной разметкой строк
 * (лента, отчёт, бюджет на год), которые не переезжают на `DataTable`
 * целиком. Так шапка, значок сортировки и вид ячейки одинаковы везде, даже
 * если строку таблица рисует сама.
 */
import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, Download } from "lucide-react";
import clsx from "clsx";
import { formatNum } from "../../lib/format";
import { pluralRu } from "../../lib/plural";
import { TREE_ELBOW_LEFT, TREE_STEP, alignOf, cellClass, headClass, scaledWidth, type ColumnType, type SortDir, type Tone } from "./tableKit";

/** В покое — ↕ на 30%, у активной колонки — стрелка направления. */
export function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown className="w-3 h-3 shrink-0 opacity-30" aria-hidden />;
  const Icon = dir === "asc" ? ArrowUp : ArrowDown;
  return <Icon className="w-3 h-3 shrink-0" aria-hidden />;
}

export interface HeadSort {
  active: boolean;
  dir: SortDir;
  onToggle: () => void;
}

/**
 * Подпись сортируемой колонки — кнопка с подписью и значком. Одна на шапки
 * таблиц и списков-мер: вид и поведение сортировки в продукте одни.
 *
 * Значок — всегда после подписи, как бы колонка ни была выровнена. Прежде у
 * колонок справа он стоял перед подписью, чтобы её край совпадал с краем
 * чисел, и в одной шапке значки чередовались: «Категория ↕», «↕ Доля»,
 * «Операций ↕», «↕ Сумма». Теперь у числовой колонки над краем чисел стоит
 * сам значок, а подпись — сразу перед ним.
 */
export function SortButton({ label, sort }: { label: ReactNode; sort: HeadSort }) {
  return (
    <button
      type="button"
      onClick={sort.onToggle}
      className={clsx(
        "inline-flex items-center gap-1 min-w-0 rounded transition-colors duration-200 hover:text-text",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
        sort.active && "text-accent hover:text-accent"
      )}
    >
      <span className="truncate">{label}</span>
      <SortIcon active={sort.active} dir={sort.dir} />
    </button>
  );
}

/**
 * Ячейка шапки. Выравнивание — по типу колонки, как у значений под ней;
 * значок сортировки — после подписи у любой колонки (см. `SortButton`).
 */
export function HeadCell({
  type = "text",
  label,
  width,
  sort,
  title,
  className,
  colSpan,
  lead,
}: {
  type?: ColumnType;
  label: ReactNode;
  width?: string;
  sort?: HeadSort;
  title?: string;
  className?: string;
  colSpan?: number;
  /** Кнопка перед подписью — например, «раскрыть все». */
  lead?: ReactNode;
}) {
  const align = alignOf(type);
  const right = align === "right";
  return (
    <th
      scope="col"
      colSpan={colSpan}
      title={title}
      aria-sort={sort ? (sort.active ? (sort.dir === "asc" ? "ascending" : "descending") : "none") : undefined}
      className={headClass(type, clsx("whitespace-nowrap", className))}
      style={width ? { width: scaledWidth(width) } : undefined}
    >
      {/* Блочный flex, а не inline: строчный добавлял снизу место под
          выносные элементы, и шапка выходила 39 вместо 37. */}
      <span
        className={clsx(
          "flex items-center gap-1.5 min-w-0",
          right ? "justify-end" : align === "center" ? "justify-center" : "justify-start"
        )}
      >
        {lead}
        {sort ? (
          <SortButton label={label} sort={sort} />
        ) : (
          <span className="truncate">{label}</span>
        )}
      </span>
    </th>
  );
}

/** Ячейка строки. Вид — по типу колонки; цвет — только у главной суммы и метки. */
export function Cell({
  type = "text",
  muted,
  tone,
  className,
  title,
  colSpan,
  children,
}: {
  type?: ColumnType;
  muted?: boolean;
  tone?: Tone;
  className?: string;
  title?: string;
  colSpan?: number;
  children?: ReactNode;
}) {
  return (
    <td className={cellClass(type, { muted, tone, className })} title={title} colSpan={colSpan}>
      {children}
    </td>
  );
}

/**
 * Шеврон раскрытия перед именем родителя: ▸ свёрнуто, ▾ раскрыто. 16 px,
 * приглушённый.
 */
export function ExpandChevron({
  open,
  onToggle,
  label,
  tabIndex,
}: {
  open: boolean;
  onToggle?: () => void;
  /** Что раскрывается — для скринридера. Без обработчика шеврон просто значок. */
  label?: string;
  /** `-1` — для копии шапки, которую не должен обходить Tab. */
  tabIndex?: number;
}) {
  const icon = (
    <ChevronDown
      className={clsx("w-4 h-4 transition-transform duration-200", !open && "-rotate-90")}
      aria-hidden
    />
  );
  if (!onToggle) return <span className="inline-flex shrink-0 text-muted">{icon}</span>;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-expanded={open}
      aria-label={label}
      title={label}
      tabIndex={tabIndex}
      className="btn-icon btn-icon-xs shrink-0 -m-0.5"
    >
      {icon}
    </button>
  );
}

/**
 * Уголок к родителю у подстроки дерева: вертикаль 1 px и горизонталь 8 px
 * цвета канта. Стоит под началом имени родителя, имя подстроки — на 16 px
 * правее конца уголка. Ячейка, в которой он стоит, должна быть `relative`, а
 * её левое поле — `treeIndent(depth)`.
 */
export function TreeElbow({ depth, last }: { depth: number; last: boolean }) {
  const left = TREE_ELBOW_LEFT + (depth - 1) * TREE_STEP;
  return (
    <>
      <span
        aria-hidden
        className={clsx("absolute top-0 w-px bg-border", last ? "bottom-1/2" : "bottom-0")}
        style={{ left }}
      />
      <span aria-hidden className="absolute top-1/2 w-2 h-px bg-border" style={{ left }} />
    </>
  );
}

/** Выгрузка таблицы — компактной кнопкой в шапке карточки. */
export function ExportButton({ rows, onClick }: { rows: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="btn-ghost text-xs shrink-0"
      title={`Скачать как CSV: ${formatNum(rows)} ${pluralRu(rows, ["строка", "строки", "строк"])}`}
    >
      <Download className="w-3.5 h-3.5" aria-hidden />
      CSV ({formatNum(rows)})
    </button>
  );
}

/** Подвал длинной таблицы: первая порция строк, затем «ещё» и «все». */
export function ShowMore({
  shown,
  total,
  step,
  onMore,
  onAll,
}: {
  shown: number;
  total: number;
  step: number;
  onMore: () => void;
  onAll: () => void;
}) {
  if (shown >= total) return null;
  return (
    <div className="flex items-center justify-center gap-3 mt-3">
      <span className="text-xs text-muted tabular-nums">
        Показано {formatNum(shown)} из {formatNum(total)}
      </span>
      <button type="button" onClick={onMore} className="btn-ghost text-xs">
        Показать ещё {formatNum(Math.min(step, total - shown))}
      </button>
      <button type="button" onClick={onAll} className="text-xs text-accent hover:underline">
        Показать все
      </button>
    </div>
  );
}
