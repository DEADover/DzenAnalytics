import { useCallback, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import clsx from "clsx";
import { CardHeader } from "./CardHeader";
import { Checkbox } from "./Checkbox";
import { Cell, ExpandChevron, ExportButton, HeadCell, ShowMore, TreeElbow } from "./table/TableParts";
import {
  COLUMN_TYPES,
  buildCsv,
  csvFileName,
  downloadCsv,
  nextSort,
  scaledWidth,
  sortRows,
  treeIndent,
  type ColumnType,
  type Density,
  type SortDir,
  type SortState,
  type SortValue,
  type Tone,
} from "./table/tableKit";

export type { ColumnType, Density, SortDir, SortState, Tone } from "./table/tableKit";

/**
 * Колонка таблицы.
 *
 * `type` обязателен: из него следуют выравнивание, начертание, цвет, первое
 * направление сортировки и выгрузка (см. `table/tableKit.ts`). Своих классов
 * у ячейки нет — `render` отдаёт только содержимое.
 */
export interface Column<T> {
  key: string;
  label: string;
  type: ColumnType;
  /** Ширина колонки (CSS-длина). Нужна фиксированной таблице — иначе колонки прыгают при смене данных. */
  width?: string;
  /** По умолчанию колонка сортируется, если у неё есть `sortValue` и тип не «действия». */
  sortable?: boolean;
  sortValue?: (row: T) => SortValue;
  /** Значение для CSV. По умолчанию — `sortValue`. */
  exportValue?: (row: T) => SortValue;
  /** Не выгружать колонку вовсе. */
  exportSkip?: boolean;
  /** Вторичный текст или второстепенная сумма — приглушённо. */
  muted?: boolean;
  /** Цвет главной суммы или метки — на всю колонку или по строке. */
  tone?: Tone | ((row: T) => Tone | undefined);
  /** Подсказка к заголовку колонки. */
  headerTitle?: string;
  /**
   * Контрол в шапке рядом с подписью — например, «₽ / %». Стоит перед
   * подписью: у колонки справа так подпись остаётся над краем чисел.
   */
  headerLead?: ReactNode;
  /** Подсказка к ячейке. У текста в фиксированной таблице по умолчанию — сам текст. */
  cellTitle?: (row: T) => string | undefined;
  render: (row: T, index: number) => ReactNode;
}

interface Props<T> {
  data: readonly T[];
  columns: readonly Column<T>[];
  rowKey: (row: T, index: number) => string;

  /** Сортировка при открытии. Направление по умолчанию — первое для типа колонки. */
  defaultSortKey?: string;
  defaultSortDir?: SortDir;
  /** Управляемая сортировка — когда порядок нужен странице (выделение, «открыть всё»). */
  sort?: SortState;
  onSortChange?: (next: SortState) => void;

  onRowClick?: (row: T) => void;
  onRowDoubleClick?: (row: T) => void;
  /** Наведение на строку и уход с неё — для связки с графиком рядом. */
  onRowHover?: (row: T | null) => void;
  rowClassName?: (row: T) => string | undefined;
  emptyText?: ReactNode;
  /** Первая порция строк; дальше — «Показать ещё» и «Показать все». */
  limit?: number;

  /** Шапка карточки: значок, заголовок, «?», свои кнопки и выгрузка справа. */
  title?: ReactNode;
  icon?: LucideIcon;
  info?: ReactNode;
  actions?: ReactNode;
  exportName?: string;
  exportable?: boolean;
  /**
   * Куда поставить кнопку выгрузки, если у таблицы нет своей шапки: в строку
   * заголовка карточки, в которой таблица стоит. Иначе ради одной кнопки
   * «CSV» появлялась отдельная строка над таблицей. Пока место не отрисовано
   * (`null`), кнопки нет нигде.
   */
  exportSlot?: HTMLElement | null;
  /** Без карточки — для таблицы внутри окна, шторки или другой карточки. */
  bare?: boolean;
  className?: string;

  /** Ширины из колонок, а не из содержимого: колонки не прыгают при смене данных. */
  fixed?: boolean;
  density?: Density;
  stickyHead?: boolean;
  /**
   * Ширина, уже которой таблица не сжимается, а прокручивается вбок, — чтобы
   * подписи шапки не обрезались. Растёт с размером текста таблиц, как ширины
   * колонок.
   */
  minWidth?: string;

  /** Выбор строк чекбоксами. Ключи — из `rowKey`. */
  selection?: {
    selected: ReadonlySet<string>;
    onChange: (next: Set<string>) => void;
    /** Что выбирает чекбокс в шапке — для скринридера. */
    label?: string;
  };

  /**
   * Дерево: подстроки того же вида под родителем. Раскрываются шевроном перед
   * именем (или кликом по строке, если своего клика у неё нет), сортируются
   * внутри родителя тем же порядком.
   */
  subRows?: (row: T) => readonly T[] | undefined;
  expanded?: ReadonlySet<string>;
  onExpandedChange?: (next: Set<string>) => void;

  /** Строки итогов под таблицей — ячейками `Cell`. */
  footer?: ReactNode;
}

function isSortable<T>(c: Column<T>): boolean {
  return c.sortable !== false && COLUMN_TYPES[c.type].sortable && !!c.sortValue;
}

interface FlatRow<T> {
  row: T;
  key: string;
  depth: number;
  last: boolean;
  hasChildren: boolean;
  index: number;
}

export function DataTable<T>({
  data,
  columns,
  rowKey,
  defaultSortKey,
  defaultSortDir,
  sort: controlledSort,
  onSortChange,
  onRowClick,
  onRowDoubleClick,
  onRowHover,
  rowClassName,
  emptyText = "Нет данных",
  limit,
  title,
  icon,
  info,
  actions,
  exportName,
  exportable = true,
  exportSlot,
  bare = false,
  className,
  fixed = false,
  density = "regular",
  stickyHead = false,
  minWidth,
  selection,
  subRows,
  expanded: controlledExpanded,
  onExpandedChange,
  footer,
}: Props<T>) {
  const defaultCol = columns.find((c) => c.key === defaultSortKey);
  const [ownSort, setOwnSort] = useState<SortState>({
    key: defaultSortKey,
    dir: defaultSortDir ?? (defaultCol ? COLUMN_TYPES[defaultCol.type].firstDir : "desc"),
  });
  const sort = controlledSort ?? ownSort;
  const setSort = (next: SortState) => {
    if (!controlledSort) setOwnSort(next);
    onSortChange?.(next);
  };

  const [ownExpanded, setOwnExpanded] = useState<Set<string>>(() => new Set());
  const expanded = controlledExpanded ?? ownExpanded;
  const setExpanded = (next: Set<string>) => {
    if (!controlledExpanded) setOwnExpanded(next);
    onExpandedChange?.(next);
  };

  const sortCol = columns.find((c) => c.key === sort.key);
  const order = useCallback(
    (rows: readonly T[]) =>
      sortCol?.sortValue && isSortable(sortCol)
        ? sortRows(rows, sortCol.sortValue, sort.dir)
        : [...rows],
    [sortCol, sort.dir]
  );
  const sorted = useMemo(() => order(data), [order, data]);

  // Первая порция — не потолок: дальше «Показать ещё». Данные сменились (другой
  // фильтр, вкладка) — счётчик заново, прямо в рендере, без лишнего прохода.
  const [shown, setShown] = useState(limit ?? 0);
  const [seenData, setSeenData] = useState(data);
  if (seenData !== data) {
    setSeenData(data);
    setShown(limit ?? 0);
  }
  const visible = limit ? sorted.slice(0, Math.max(shown, limit)) : sorted;

  const flat = useMemo(() => {
    const out: FlatRow<T>[] = [];
    const walk = (rows: readonly T[], depth: number, parentKey: string) => {
      rows.forEach((row, i) => {
        const own = rowKey(row, i);
        const key = parentKey ? `${parentKey}/${own}` : own;
        const children = subRows?.(row);
        const hasChildren = !!children && children.length > 0;
        out.push({ row, key, depth, last: i === rows.length - 1, hasChildren, index: i });
        if (hasChildren && expanded.has(key)) walk(order(children!), depth + 1, key);
      });
    };
    walk(visible, 0, "");
    return out;
  }, [visible, subRows, expanded, order, rowKey]);

  const toggleExpanded = (key: string) => {
    const next = new Set(expanded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExpanded(next);
  };
  const expandableKeys = subRows
    ? visible.flatMap((row, i) => ((subRows(row)?.length ?? 0) > 0 ? [rowKey(row, i)] : []))
    : [];
  const allExpanded = expandableKeys.length > 0 && expandableKeys.every((k) => expanded.has(k));

  const exportCols = columns.filter((c) => COLUMN_TYPES[c.type].exported && !c.exportSkip);
  const showExport = exportable && sorted.length > 0 && exportCols.length > 0;
  const exportCsv = () => {
    const text = buildCsv(
      exportCols.map((c) => c.label),
      sorted.map((row) => exportCols.map((c) => (c.exportValue ?? c.sortValue)?.(row) ?? ""))
    );
    downloadCsv(csvFileName(exportName), text);
  };

  const allKeys = selection ? sorted.map((row, i) => rowKey(row, i)) : [];
  const selectedCount = selection ? allKeys.filter((k) => selection.selected.has(k)).length : 0;

  const colCount = columns.length + (selection ? 1 : 0);
  const exportInHeader = showExport && exportSlot === undefined;
  const hasHeader =
    title !== undefined || icon !== undefined || exportInHeader || actions !== undefined;

  const table = (
    <>
      {hasHeader && (
        <CardHeader
          icon={icon}
          title={title}
          info={info}
          right={
            actions || exportInHeader ? (
              <>
                {actions}
                {exportInHeader && <ExportButton rows={sorted.length} onClick={exportCsv} />}
              </>
            ) : undefined
          }
        />
      )}
      {/* Липкой шапке нужен прокручиваемый предок снаружи: своя обёртка с
          горизонтальной прокруткой стала бы им сама и не дала бы шапке липнуть. */}
      <div className={stickyHead ? undefined : "overflow-x-auto"}>
        <table
          className={clsx("w-full", fixed && "table-fixed", density === "compact" && "table-compact")}
          style={minWidth ? { minWidth: scaledWidth(minWidth) } : undefined}
        >
          {fixed && (
            <colgroup>
              {selection && <col style={{ width: "2.5rem" }} />}
              {columns.map((c) => (
                <col key={c.key} style={c.width ? { width: scaledWidth(c.width) } : undefined} />
              ))}
            </colgroup>
          )}
          <thead className={stickyHead ? "sticky top-0 z-10 bg-panel" : undefined}>
            <tr>
              {selection && (
                <th scope="col" className="table-th text-center" style={fixed ? undefined : { width: "2.5rem" }}>
                  <Checkbox
                    checked={selectedCount > 0 && selectedCount === allKeys.length}
                    indeterminate={selectedCount > 0}
                    // Чекбокс шапки отмечает и снимает только строки этой таблицы:
                    // выбор может быть общим на несколько таблиц (группы дубликатов).
                    onChange={(on) => {
                      const next = new Set(selection.selected);
                      for (const k of allKeys) {
                        if (on) next.add(k);
                        else next.delete(k);
                      }
                      selection.onChange(next);
                    }}
                    label={selection.label ?? "Выбрать все строки"}
                  />
                </th>
              )}
              {columns.map((c, ci) => (
                <HeadCell
                  key={c.key}
                  type={c.type}
                  label={c.label}
                  width={fixed ? undefined : c.width}
                  title={c.headerTitle}
                  lead={
                    ci === 0 && expandableKeys.length > 0 ? (
                      <ExpandChevron
                        open={allExpanded}
                        onToggle={() => setExpanded(allExpanded ? new Set() : new Set(expandableKeys))}
                        label={allExpanded ? "Свернуть все" : "Раскрыть все"}
                      />
                    ) : (
                      c.headerLead
                    )
                  }
                  sort={
                    isSortable(c)
                      ? {
                          active: sort.key === c.key,
                          dir: sort.dir,
                          onToggle: () => setSort(nextSort(sort, c.key, c.type)),
                        }
                      : undefined
                  }
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {flat.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="table-td text-center text-muted py-6">
                  {emptyText}
                </td>
              </tr>
            ) : (
              flat.map((f) => {
                const isSelected = !!selection?.selected.has(f.key);
                const toggles = f.hasChildren && !onRowClick;
                const clickable = !!onRowClick || toggles;
                return (
                  <tr
                    key={f.key}
                    onClick={
                      onRowClick
                        ? () => onRowClick(f.row)
                        : toggles
                          ? () => toggleExpanded(f.key)
                          : undefined
                    }
                    onDoubleClick={onRowDoubleClick ? () => onRowDoubleClick(f.row) : undefined}
                    onMouseEnter={onRowHover ? () => onRowHover(f.row) : undefined}
                    onMouseLeave={onRowHover ? () => onRowHover(null) : undefined}
                    className={clsx(
                      isSelected ? "bg-accent/5" : clickable && "hover:bg-panel2/50",
                      clickable && "cursor-pointer",
                      rowClassName?.(f.row)
                    )}
                  >
                    {selection && (
                      <td className="table-td text-center">
                        {f.depth === 0 && (
                          <Checkbox
                            checked={isSelected}
                            stopPropagation
                            onChange={(on) => {
                              const next = new Set(selection.selected);
                              if (on) next.add(f.key);
                              else next.delete(f.key);
                              selection.onChange(next);
                            }}
                            label="Выбрать строку"
                          />
                        )}
                      </td>
                    )}
                    {columns.map((c, ci) => {
                      const content = c.render(f.row, f.index);
                      const tone = typeof c.tone === "function" ? c.tone(f.row) : c.tone;
                      const textTitle =
                        c.cellTitle?.(f.row) ??
                        (fixed && c.type === "text" && typeof c.sortValue?.(f.row) === "string"
                          ? (c.sortValue?.(f.row) as string) || undefined
                          : undefined);
                      const tree = ci === 0 && (f.depth > 0 || expandableKeys.length > 0);
                      if (!tree) {
                        return (
                          <Cell
                            key={c.key}
                            type={c.type}
                            muted={c.muted}
                            tone={tone}
                            title={textTitle}
                            className={fixed && c.type === "text" ? "truncate" : undefined}
                          >
                            {content}
                          </Cell>
                        );
                      }
                      return (
                        <td
                          key={c.key}
                          title={textTitle}
                          className={clsx("table-td relative", f.depth > 0 && "text-muted")}
                          style={f.depth > 0 ? { paddingLeft: treeIndent(f.depth) } : undefined}
                        >
                          {f.depth > 0 && <TreeElbow depth={f.depth} last={f.last} />}
                          <span className="flex items-center gap-1.5 min-w-0">
                            {f.depth === 0 &&
                              (f.hasChildren ? (
                                <ExpandChevron
                                  open={expanded.has(f.key)}
                                  onToggle={() => toggleExpanded(f.key)}
                                  label={expanded.has(f.key) ? "Свернуть" : "Раскрыть"}
                                />
                              ) : (
                                <span className="w-4 shrink-0" aria-hidden />
                              ))}
                            {f.depth > 0 && f.hasChildren && (
                              <ExpandChevron
                                open={expanded.has(f.key)}
                                onToggle={() => toggleExpanded(f.key)}
                                label={expanded.has(f.key) ? "Свернуть" : "Раскрыть"}
                              />
                            )}
                            {/* Растягивается на всю ширину колонки: иначе содержимое
                                с полосой («Полосы» на «Категориях») сжималось до
                                длины названия, и полоса выходила короче текста.
                                Обрезка — только по горизонтали: засечка сравнения
                                выступает под полосу, и `overflow: hidden` срезал
                                её низ. */}
                            <span className="block flex-1 min-w-0 overflow-x-clip text-ellipsis whitespace-nowrap">
                              {content}
                            </span>
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
          {footer && <tfoot>{footer}</tfoot>}
        </table>
      </div>
      {showExport &&
        exportSlot &&
        createPortal(<ExportButton rows={sorted.length} onClick={exportCsv} />, exportSlot)}
      {limit !== undefined && (
        <ShowMore
          shown={visible.length}
          total={sorted.length}
          step={limit}
          onMore={() => setShown(visible.length + limit)}
          onAll={() => setShown(sorted.length)}
        />
      )}
    </>
  );

  if (bare) return <div className={className}>{table}</div>;
  return <div className={clsx("card-tray px-4 py-3", className)}>{table}</div>;
}
