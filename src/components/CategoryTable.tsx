import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { currencySymbol, formatMoney, formatNum, formatPct } from "../lib/format";
import { CategoryDot } from "./CategoryDot";
import { DataTable, type Column } from "./DataTable";
import { DeviationPill } from "./DeviationPill";

/**
 * Строка таблицы категорий: категория или её подкатегория.
 *
 * `key` — полное имя («Еда / Кафе» у подкатегории), `name` — то, что написано
 * в строке: у подкатегории без повтора родителя.
 */
export interface CategoryTableRow {
  key: string;
  name: string;
  /** Родитель подкатегории — для значка и подсказки. */
  parent?: string;
  value: number;
  count: number;
  /** Доля от итога таблицы, 0…1. */
  share: number;
  /** С чем сравниваем: среднее за прошлые месяцы или второй период. */
  compare?: number;
  /** Цвет полосы. */
  color?: string;
  /** Цвет значка, если у подкатегории своего нет. */
  dotFallback?: string;
  children?: CategoryTableRow[];
}

interface CompareSpec {
  label: string;
  title?: string;
  changeLabel: string;
  changeTitle: string;
  /** Есть ли с чем сравнивать вовсе. */
  comparable: boolean;
  sameLabel: string;
  upTitle: string;
  downTitle: string;
  /** Подпись засечки на полосе: «Среднее за 3 мес», «Май 26 г.». */
  markerLabel: string;
  /** Разница в процентах, а не в деньгах. */
  asPct: boolean;
  onAsPctChange: (next: boolean) => void;
}

/**
 * Таблица категорий — одна на «Категории» (кольцо и полосы) и «Сравнение».
 *
 * Раньше это были три скопированных списка на `div` со своей шапкой: числа
 * прижаты влево, сортировки нет, подкатегории отбиты цветной полосой. Теперь
 * это обычная таблица продукта: числа справа, сортировка по любой колонке,
 * подкатегории — уголком под родителем.
 */
export function CategoryTable({
  rows,
  base,
  kind,
  valueLabel = "Сумма",
  valueTitle,
  bar = false,
  barMax,
  compare,
  onRowClick,
  expanded,
  onExpandedChange,
  hoverKey,
  onHover,
  exportName,
  exportSlot,
  emptyText,
  card = false,
  icon,
  title,
  actions,
}: {
  rows: CategoryTableRow[];
  base: string;
  kind: "expense" | "income";
  valueLabel?: string;
  valueTitle?: string;
  /** Полоса под именем: длина — от крупнейшей строки, засечка — значение сравнения. */
  bar?: boolean;
  barMax?: number;
  compare?: CompareSpec;
  onRowClick: (row: CategoryTableRow) => void;
  expanded?: ReadonlySet<string>;
  onExpandedChange?: (next: Set<string>) => void;
  /** Строка, подсвеченная снаружи — например, наведением на кольцо. */
  hoverKey?: string | null;
  onHover?: (row: CategoryTableRow | null) => void;
  exportName?: string;
  /** Кнопка выгрузки в чужой строке заголовка — см. `DataTable`. */
  exportSlot?: HTMLElement | null;
  emptyText?: ReactNode;
  /** Своя карточка с шапкой. Без неё таблица встаёт в чужую карточку. */
  card?: boolean;
  icon?: LucideIcon;
  title?: ReactNode;
  actions?: ReactNode;
}) {
  const max = barMax ?? rows.reduce((m, r) => Math.max(m, r.value, r.compare ?? 0), 0);

  const columns: Column<CategoryTableRow>[] = [
    {
      key: "name",
      type: "text",
      label: "Категория",
      sortValue: (r) => r.name,
      exportValue: (r) => r.key,
      cellTitle: (r) => (r.parent ? `${r.parent} / ${r.name}` : r.name),
      render: (r) => (
        <span className="flex items-center gap-2 min-w-0">
          <CategoryDot category={r.name} parent={r.parent} fallback={r.dotFallback} size="w-5 h-5" />
          <span className="flex-1 min-w-0">
            <span className="block truncate">{r.name}</span>
            {bar && <CategoryBar row={r} max={max} markerLabel={compare?.markerLabel} base={base} />}
          </span>
        </span>
      ),
    },
    {
      key: "share",
      type: "pct",
      width: "5.5rem",
      label: "Доля",
      sortValue: (r) => r.share,
      render: (r) => formatPct(r.share, 1),
    },
    {
      key: "count",
      type: "count",
      // «Операций» с значком сортировки — 111 px при обычном размере текста:
      // в 6.5rem подпись обрезалась до «Операц…», и колонка выглядела сбитой.
      width: "7.5rem",
      label: "Операций",
      sortValue: (r) => r.count,
      render: (r) => formatNum(r.count),
    },
    {
      key: "value",
      type: "main",
      tone: kind,
      // Сумма до «99 999 999 ₽»: 9rem оставляли слева от коротких сумм полосу
      // пустоты, и счётчик рядом казался уехавшим влево.
      width: "8rem",
      label: valueLabel,
      headerTitle: valueTitle,
      sortValue: (r) => r.value,
      render: (r) => formatMoney(r.value, base),
    },
  ];

  if (compare) {
    columns.push(
      {
        key: "compare",
        type: "money",
        muted: true,
        width: "9rem",
        label: compare.label,
        headerTitle: compare.title,
        sortValue: (r) => (compare.comparable ? r.compare : undefined),
        render: (r) =>
          compare.comparable && r.compare !== undefined && r.compare > 0
            ? formatMoney(r.compare, base)
            : "—",
      },
      {
        key: "change",
        type: "change",
        width: "9.5rem",
        label: compare.changeLabel,
        headerTitle: compare.changeTitle,
        headerLead: (
          <button
            type="button"
            onClick={() => compare.onAsPctChange(!compare.asPct)}
            className="normal-case rounded bg-panel2 px-1 leading-4 text-text hover:text-accent transition-colors"
            title={`Показать разницу ${compare.asPct ? "в деньгах" : "в процентах"}`}
            aria-label={`Показать разницу ${compare.asPct ? "в деньгах" : "в процентах"}`}
          >
            {compare.asPct ? "%" : currencySymbol(base)}
          </button>
        ),
        sortValue: (r) => {
          if (!compare.comparable || r.compare === undefined) return undefined;
          const diff = r.value - r.compare;
          return compare.asPct ? (r.compare !== 0 ? diff / Math.abs(r.compare) : undefined) : diff;
        },
        render: (r) => (
          <DeviationPill
            current={r.value}
            baseline={r.compare}
            base={base}
            asPct={compare.asPct}
            kind={kind}
            comparable={compare.comparable}
            sameLabel={compare.sameLabel}
            upTitle={compare.upTitle}
            downTitle={compare.downTitle}
          />
        ),
      }
    );
  }

  return (
    <DataTable<CategoryTableRow>
      bare={!card}
      icon={icon}
      title={title}
      actions={actions}
      fixed
      data={rows}
      columns={columns}
      rowKey={(r) => r.key}
      subRows={(r) => r.children}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      defaultSortKey="value"
      onRowClick={onRowClick}
      onRowHover={onHover}
      rowClassName={(r) => (hoverKey && hoverKey === r.key ? "bg-panel2/50" : undefined)}
      exportable={!!exportName}
      exportName={exportName}
      exportSlot={exportSlot}
      emptyText={emptyText}
    />
  );
}

/** Полоса под именем категории и засечка сравнения на ней. */
function CategoryBar({
  row,
  max,
  markerLabel,
  base,
}: {
  row: CategoryTableRow;
  max: number;
  markerLabel?: string;
  base: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (row.value / max) * 100)) : 0;
  const mark = row.compare !== undefined && row.compare > 0 && max > 0
    ? Math.min(100, (row.compare / max) * 100)
    : null;
  return (
    <span className="relative block h-1.5 mt-1 mr-3">
      <span className="absolute inset-0 bg-panel2 rounded-full overflow-hidden">
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: row.color }} />
      </span>
      {mark !== null && (
        <span
          className="absolute top-1/2 -translate-y-1/2 w-0 border-l-2 border-solid border-text/80"
          style={{ left: `${mark}%`, height: "200%" }}
          title={markerLabel ? `${markerLabel}: ${formatMoney(row.compare!, base)}` : undefined}
        />
      )}
    </span>
  );
}
