import { Fragment, useMemo, useState, type ReactNode } from "react";
import { ArrowUpDown, Download, ChevronRight, ChevronDown } from "lucide-react";
import clsx from "clsx";

export type SortDir = "asc" | "desc";

export interface Column<T> {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  width?: string;
  sortable?: boolean;
  sortValue?: (row: T) => string | number | null | undefined;
  exportValue?: (row: T) => string | number | null | undefined;
  /**
   * Не выгружать колонку в CSV. Нужно колонкам действий: кнопки в файле
   * бессмысленны, а `exportValue: () => ""` убирал только значения — сам
   * столбец с заголовком оставался, добавляя каждой строке пустую ячейку.
   */
  exportSkip?: boolean;
  render: (row: T, index: number) => ReactNode;
}

interface Props<T> {
  data: T[];
  columns: Column<T>[];
  rowKey: (row: T, index: number) => string | number;
  defaultSortKey?: string;
  defaultSortDir?: SortDir;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  emptyText?: string;
  limit?: number;
  className?: string;
  exportName?: string;
  exportable?: boolean;
  /** Fixed table layout — column widths come from each column's `width` (not the
   *  content), so they never shift when the data changes (tab/period switches).
   *  Pair with `width` on the columns and `truncate` in their renderers. */
  fixed?: boolean;
  /** Optional heading rendered on the same row as the CSV button (left side),
   *  so a card title and the export control share one line. */
  title?: ReactNode;
  /**
   * Expandable rows. When `renderExpanded` is set, a leading chevron column
   * appears and clicking a row toggles it (via `onToggleExpand`). The function
   * must return table ROWS (`<tr>` fragments) inserted right after the row, so
   * their cells line up with the columns — start each `<tr>` with an empty
   * `<td>` for the chevron column. `onRowClick` is ignored in this mode.
   */
  renderExpanded?: (row: T) => ReactNode;
  isExpanded?: (row: T) => boolean;
  onToggleExpand?: (row: T) => void;
  /**
   * «Раскрыть / свернуть все» иконкой в шапке колонки-шеврона. Без этого
   * обработчика шапка там пустая, как и была. Аргумент говорит, что просят:
   * `true` — раскрыть всё, `false` — свернуть; какие именно строки этому
   * соответствуют, решает страница — таблица её набора не знает.
   */
  onToggleAllExpanded?: (expand: boolean) => void;
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // Defuse CSV/spreadsheet formula injection: prefix risky leading chars with '
  if (s.length > 0 && /^[=+\-@\t\r]/.test(s)) {
    s = "'" + s;
  }
  if (s.includes(";") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function SortableTable<T>({
  data,
  columns,
  rowKey,
  defaultSortKey,
  defaultSortDir = "desc",
  onRowClick,
  rowClassName,
  emptyText = "Нет данных",
  limit,
  className,
  exportName,
  exportable = true,
  fixed = false,
  title,
  renderExpanded,
  isExpanded,
  onToggleExpand,
  onToggleAllExpanded,
}: Props<T>) {
  const expandable = !!renderExpanded;
  const [sortKey, setSortKey] = useState<string | undefined>(defaultSortKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultSortDir);

  const sorted = useMemo(() => {
    if (!sortKey) return data;
    const col = columns.find((c) => c.key === sortKey);
    if (!col || !col.sortValue) return data;
    const arr = [...data];
    arr.sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      const naN = va === null || va === undefined;
      const nbN = vb === null || vb === undefined;
      if (naN && nbN) return 0;
      if (naN) return 1;
      if (nbN) return -1;
      let r: number;
      if (typeof va === "number" && typeof vb === "number") r = va - vb;
      else r = String(va).localeCompare(String(vb), "ru");
      return sortDir === "asc" ? r : -r;
    });
    return arr;
  }, [data, columns, sortKey, sortDir]);

  function toggleSort(key: string) {
    const col = columns.find((c) => c.key === key);
    if (!col || col.sortable === false || !col.sortValue) return;
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function exportCsv() {
    const cols = columns.filter((c) => !c.exportSkip);
    const header = cols.map((c) => csvEscape(c.label)).join(";");
    const lines = [header];
    for (const row of sorted) {
      const cells = cols.map((c) => {
        let val: unknown;
        if (c.exportValue) val = c.exportValue(row);
        else if (c.sortValue) val = c.sortValue(row);
        else val = "";
        return csvEscape(val);
      });
      lines.push(cells.join(";"));
    }
    const blob = new Blob(["﻿" + lines.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    const safe = (exportName || "table").toLowerCase().replace(/[^a-z0-9а-яё_-]+/gi, "_");
    a.href = url;
    a.download = `dzenanalytics_${safe}_${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Сколько строк показано сейчас.
   *
   * `limit` — это первая порция, а не потолок: раньше остальные строки нельзя
   * было увидеть вовсе, внизу просто стояло «Показано 40 из 176». На
   * «Регулярных платежах» это выглядело как сломанная пагинация — список есть,
   * а долистать до конца нечем.
   */
  const [shown, setShown] = useState(limit ?? 0);
  // Данные сменились (другой фильтр, другая вкладка) — счётчик начинает заново,
  // иначе следующий список открывался бы уже раскрытым. Сброс идёт ПРЯМО В
  // РЕНДЕРЕ, а не в эффекте: так новая порция считается сразу, без лишнего
  // прохода с прежним числом строк.
  const [seenData, setSeenData] = useState(data);
  if (seenData !== data) {
    setSeenData(data);
    setShown(limit ?? 0);
  }
  const visible = limit ? sorted.slice(0, Math.max(shown, limit)) : sorted;
  const showExport = exportable && sorted.length > 0;
  // Раскрыто всё — считаем по ПОКАЗАННЫМ строкам: кнопка в шапке отвечает за
  // то, что видно, а не за скрытый хвост под `limit`.
  const allExpanded =
    expandable && visible.length > 0 && visible.every((row) => !!isExpanded?.(row));

  return (
    <div className={clsx(className)}>
      {(title || showExport) && (
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="font-semibold">{title}</div>
          {showExport && (
            <button
              onClick={exportCsv}
              className="btn-ghost text-xs shrink-0"
              title={`Скачать как CSV (${sorted.length} строк)`}
            >
              <Download className="w-3.5 h-3.5" />
              CSV ({sorted.length})
            </button>
          )}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className={clsx("w-full text-sm", fixed && "table-fixed")}>
          <thead>
            <tr>
              {expandable &&
                (onToggleAllExpanded && visible.length > 0 ? (
                  <th className="table-th w-8">
                    <button
                      type="button"
                      onClick={() => onToggleAllExpanded(!allExpanded)}
                      aria-expanded={allExpanded}
                      title={allExpanded ? "Свернуть все" : "Раскрыть все"}
                      aria-label={allExpanded ? "Свернуть все" : "Раскрыть все"}
                      className="-m-1 p-1 rounded-md text-muted hover:text-accent hover:bg-panel2"
                    >
                      <ChevronDown
                        className={clsx(
                          "w-4 h-4 transition-transform duration-300",
                          !allExpanded && "-rotate-90"
                        )}
                      />
                    </button>
                  </th>
                ) : (
                  <th className="table-th w-8" aria-hidden />
                ))}
              {columns.map((c) => {
                const sortable = c.sortable !== false && !!c.sortValue;
                const active = sortKey === c.key;
                return (
                  <th
                    key={c.key}
                    className={clsx(
                      "table-th",
                      c.align === "right" && "text-right",
                      c.align === "center" && "text-center"
                    )}
                    style={c.width ? { width: c.width } : undefined}
                  >
                    {sortable ? (
                      <button
                        onClick={() => toggleSort(c.key)}
                        className={clsx(
                          "inline-flex items-center gap-1 uppercase tracking-wider hover:text-text transition-colors",
                          active && "text-accent"
                        )}
                      >
                        {c.label}
                        <ArrowUpDown className={clsx("w-3 h-3", !active && "opacity-30")} />
                        {active && (
                          <span className="text-[10px]">{sortDir === "asc" ? "↑" : "↓"}</span>
                        )}
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (expandable ? 1 : 0)}
                  className="table-td text-center text-muted py-6"
                >
                  {emptyText}
                </td>
              </tr>
            ) : (
              visible.map((row, i) => {
                const open = expandable && !!isExpanded?.(row);
                const handleClick = expandable
                  ? () => onToggleExpand?.(row)
                  : onRowClick
                    ? () => onRowClick(row)
                    : undefined;
                return (
                  <Fragment key={rowKey(row, i)}>
                    <tr
                      onClick={handleClick}
                      className={clsx(
                        "align-middle",
                        (expandable || onRowClick) && "hover:bg-panel2/50 cursor-pointer",
                        rowClassName?.(row)
                      )}
                    >
                      {expandable && (
                        <td className="table-td">
                          {open ? (
                            <ChevronDown className="w-4 h-4 text-muted" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-muted" />
                          )}
                        </td>
                      )}
                      {columns.map((c) => (
                        <td
                          key={c.key}
                          className={clsx(
                            "table-td",
                            c.align === "right" && "text-right",
                            c.align === "center" && "text-center"
                          )}
                        >
                          {c.render(row, i)}
                        </td>
                      ))}
                    </tr>
                    {open && renderExpanded!(row)}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {limit && sorted.length > visible.length && (
        <div className="flex items-center justify-center gap-3 mt-3">
          <span className="text-xs text-muted">
            Показано {visible.length} из {sorted.length}
          </span>
          <button
            type="button"
            onClick={() => setShown(visible.length + limit)}
            className="btn-ghost text-xs !py-1"
          >
            Показать ещё {Math.min(limit, sorted.length - visible.length)}
          </button>
          <button
            type="button"
            onClick={() => setShown(sorted.length)}
            className="text-xs text-accent hover:underline"
          >
            Показать все
          </button>
        </div>
      )}
    </div>
  );
}
