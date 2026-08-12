import { useMemo, useState } from "react";
import {
  Table as TableIcon,
  Download,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useFiltersStore, applyFilters } from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useDrillStore } from "../store/useDrillStore";
import { confirm } from "../store/useConfirmStore";
import { useAnalyticsTransactions } from "../hooks/useAnalyticsTransactions";
import { useLocalPeriod } from "../hooks/useLocalPeriod";
import {
  buildCategoryReport,
  scaleKey,
  SCALE_LABELS,
  type ReportScale,
  type ReportRow,
} from "../lib/categoryReport";
import {
  exportCategoryReportXlsx,
  type XlsxNumberStyle,
} from "../lib/categoryReportXlsx";
import { ReportExportModal } from "../components/ReportExportModal";
import { InfoPopover } from "../components/InfoPopover";
import { formatMoney } from "../lib/format";
import { EmptyState } from "../components/EmptyState";
import { GlobalFilters } from "../components/GlobalFilters";
import { PageHeader } from "../components/PageHeader";
import type { Transaction } from "../types";

const SCALES: ReportScale[] = ["month", "quarter", "year", "total"];

/**
 * «Доходы и расходы» — сводная таблица категорий по периодам (issue #54).
 *
 * Одна таблица на всю историю: строки — категории с вложенными
 * подкатегориями, столбцы — месяцы (или кварталы / годы / один столбец за всё
 * время), справа итог. Плюс выгрузка ровно этой таблицы в Excel — до сих пор
 * такую сводку приходилось собирать руками в Гугл-таблице.
 */
export function ReportPage() {
  const all = useAnalyticsTransactions();
  const base = useDataStore((s) => s.rates.base);
  const filters = useFiltersStore();
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);
  const drill = useDrillStore((s) => s.show);

  const [scale, setScale] = useState<ReportScale>("month");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [exportOpen, setExportOpen] = useState(false);

  // Отчёт — про всю историю ведения бюджета, поэтому у страницы свой период
  // (по умолчанию «Всё»), а не глобальный «текущий месяц»: иначе при первом
  // заходе таблица схлопывалась бы в один столбец. Остальные отборы —
  // счета/категории/валюты/поиск — работают как везде.
  const lp = useLocalPeriod("all");
  const effectiveFilters = useMemo(
    () => ({ ...filters, preset: lp.preset, monthYM: lp.monthYM, from: lp.from, to: lp.to }),
    [filters, lp.preset, lp.monthYM, lp.from, lp.to]
  );

  const filtered = useMemo(
    () => applyFilters(all, effectiveFilters, monthStartDay),
    [all, effectiveFilters, monthStartDay]
  );

  const report = useMemo(
    () => buildCategoryReport(filtered, scale, monthStartDay),
    [filtered, scale, monthStartDay]
  );

  const hasSubcategories = useMemo(
    () => [...report.income, ...report.expense].some((r) => r.depth === 1),
    [report]
  );
  const allParents = useMemo(
    () =>
      [...report.income, ...report.expense]
        .filter((r) => r.depth === 0)
        .map((r) => r.key),
    [report]
  );
  const allCollapsed = collapsed.size > 0 && allParents.every((k) => collapsed.has(k));

  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** Операции конкретной ячейки — для окна детализации. Родительская строка
   *  включает свои подкатегории, ровно как и её сумма в таблице. */
  function cellTransactions(
    row: ReportRow,
    side: "income" | "expense",
    colKey: string | null
  ): Transaction[] {
    return filtered.filter((t) => {
      const isIncome = t.kind === "income";
      if (side === "income" ? !isIncome : t.kind !== "expense" && t.kind !== "refund")
        return false;
      const matches =
        row.depth === 0 ? t.category === row.key : t.categoryFull === row.key;
      if (!matches) return false;
      if (colKey && scaleKey(t.date, scale, monthStartDay) !== colKey) return false;
      return true;
    });
  }

  function openCell(
    row: ReportRow,
    side: "income" | "expense",
    col: { key: string; label: string } | null
  ) {
    const txs = cellTransactions(row, side, col?.key ?? null);
    if (txs.length === 0) return;
    const title = row.depth === 0 ? row.key : `${row.parent} / ${row.label}`;
    drill(title, txs, col ? col.label : "Итого за период");
  }

  /** Имя файла показываем в окне выгрузки, поэтому считаем его в одном месте. */
  const exportFileName = `Доходы и расходы (${SCALE_LABELS[
    scale
  ].toLowerCase()}) ${new Date().toISOString().slice(0, 10)}.xlsx`;

  async function exportXlsx(style: XlsxNumberStyle) {
    try {
      await exportCategoryReportXlsx(report, base, exportFileName, style);
    } catch {
      // Молчаливый провал выгрузки хуже отсутствия кнопки: человек ждёт файл,
      // а его нет и никто об этом не сказал.
      void confirm({
        title: "Не получилось собрать файл",
        message:
          "Отчёт не выгрузился в Excel. Попробуйте ещё раз — а если повторится, уменьшите период или выберите шкалу покрупнее.",
        confirmLabel: "Понятно",
        tone: "warning",
      });
      // Пробрасываем дальше, чтобы окно выгрузки осталось открытым и человек
      // мог попробовать снова, не начиная путь с кнопки.
      throw new Error("export failed");
    }
  }

  const empty = report.columns.length === 0;
  // При одном столбце «Итого» дублирует его же — прячем.
  const showTotal = report.columns.length > 1;

  if (all.length === 0) return <EmptyState />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Доходы и расходы"
        icon={TableIcon}
        hint="Все категории по периодам — одной таблицей, с выгрузкой в Excel"
      />

      <GlobalFilters period={lp} />

      <div className="flex items-center gap-2 flex-wrap">
        <span className="label">Разбивка</span>
        <div className="flex bg-panel2 rounded-lg p-1 border border-border">
          {SCALES.map((s) => (
            <button
              key={s}
              onClick={() => setScale(s)}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                scale === s ? "bg-accent text-accent-fg" : "text-muted hover:text-text"
              }`}
            >
              {s === "total" ? "Всего" : SCALE_LABELS[s]}
            </button>
          ))}
        </div>
        <InfoPopover label="Как считаются суммы">
          <p>
            <strong className="text-text">Доход</strong> — только поступления,{" "}
            <strong className="text-text">Расход</strong> — только траты.{" "}
            <strong className="text-text">Разница</strong> внизу — доход минус
            расход за тот же период.
          </p>
          <p>
            <strong className="text-text">Переводы между своими счетами</strong>{" "}
            в отчёт не попадают вовсе: деньги не потрачены и не заработаны, они
            просто переехали с одного счёта на другой. Долговые операции — тоже.
          </p>
          <p>
            <strong className="text-text">Возврат уменьшает расход</strong> своей
            категории, а не считается доходом. Купили на 60 000 и вернули 52 000
            — в категории останется 8 000, а не «60 000 расхода и 52 000
            дохода».
          </p>
          <p>
            Поэтому расход может быть{" "}
            <strong className="text-text">отрицательным</strong>: если за месяц
            вернули больше, чем потратили. Обычная причина — покупка была в одном
            месяце, а возврат пришёл в следующем: трата попала в один столбец,
            возврат в соседний. Если же в такой категории копятся деньги, которые
            по смыслу вовсе не возврат покупки (компенсация, перевод от близких,
            продажа), — категорию стоит сделать доходной в Дзен-мани, и эти
            операции переедут в «Доход».
          </p>
          <p>
            <strong className="text-text">Сумма категории включает</strong> её
            подкатегории, а <strong className="text-text">итог блока</strong> —
            сумму категорий, поэтому подкатегории не считаются дважды.
          </p>
          <p>
            <strong className="text-text">Клик по любой сумме</strong> покажет
            операции, из которых она сложилась, — включая возвраты. Это самый
            быстрый способ разобраться в неожиданной цифре.
          </p>
        </InfoPopover>
        {/* Выгрузка — в одной строке с настройкой столбцов: кнопка относится к
            тому, что ниже, а не к заголовку страницы. */}
        <span className="flex-1 min-w-2" />
        <button
          className="btn-ghost text-sm shrink-0"
          onClick={() => setExportOpen(true)}
          disabled={empty}
          title="Скачать отчёт в Excel"
        >
          <Download className="w-4 h-4" aria-hidden />
          Excel
        </button>
      </div>

      {exportOpen && (
        <ReportExportModal
          baseCurrency={base}
          fileName={exportFileName}
          onExport={exportXlsx}
          onClose={() => setExportOpen(false)}
        />
      )}

      {empty ? (
        <div className="card card-pad text-sm text-muted text-center py-10">
          За выбранный период нет доходов и расходов — измените отбор выше.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          {/* Вертикально не режем — таблицу видно целиком, прокручивается сама
              страница. Вбок прокрутка нужна: столбцов-периодов может быть
              несколько десятков. */}
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr>
                <Th sticky first>
                  {/* Свернуть/развернуть всё живёт в шапке своей колонки —
                      там же, где стоят шевроны отдельных категорий, и не
                      занимает отдельную строку над таблицей. */}
                  {hasSubcategories ? (
                    <button
                      onClick={() =>
                        setCollapsed(allCollapsed ? new Set() : new Set(allParents))
                      }
                      className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-text"
                      title={allCollapsed ? "Развернуть все" : "Свернуть все"}
                      aria-label={allCollapsed ? "Развернуть все" : "Свернуть все"}
                      aria-expanded={!allCollapsed}
                    >
                      {allCollapsed ? (
                        <ChevronRight className="w-3.5 h-3.5 shrink-0" aria-hidden />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 shrink-0" aria-hidden />
                      )}
                      Категория
                    </button>
                  ) : (
                    "Категория"
                  )}
                </Th>
                {report.columns.map((c) => (
                  <Th key={c.key} sticky align="right">
                    {c.label}
                  </Th>
                ))}
                {showTotal && (
                  <Th sticky align="right">
                    Итого
                  </Th>
                )}
              </tr>
            </thead>
            <tbody>
              <GroupRow
                title="Доход"
                values={report.incomeTotals}
                total={report.incomeTotal}
                base={base}
                tone="text-income"
                showTotal={showTotal}
              />
              {report.income.map((row) => (
                <BodyRow
                  key={`i-${row.key}`}
                  row={row}
                  base={base}
                  columns={report.columns}
                  hidden={row.depth === 1 && collapsed.has(row.parent!)}
                  collapsed={collapsed.has(row.key)}
                  hasKids={hasKids(report.income, row)}
                  showTotal={showTotal}
                  onToggle={() => toggle(row.key)}
                  onCell={(col) => openCell(row, "income", col)}
                />
              ))}
              <tr>
                <td className="h-3" colSpan={report.columns.length + (showTotal ? 2 : 1)} />
              </tr>
              <GroupRow
                title="Расход"
                values={report.expenseTotals}
                total={report.expenseTotal}
                base={base}
                tone="text-expense"
                showTotal={showTotal}
              />
              {report.expense.map((row) => (
                <BodyRow
                  key={`e-${row.key}`}
                  row={row}
                  base={base}
                  columns={report.columns}
                  hidden={row.depth === 1 && collapsed.has(row.parent!)}
                  collapsed={collapsed.has(row.key)}
                  hasKids={hasKids(report.expense, row)}
                  showTotal={showTotal}
                  onToggle={() => toggle(row.key)}
                  onCell={(col) => openCell(row, "expense", col)}
                />
              ))}
              <tr>
                <td className="h-3" colSpan={report.columns.length + (showTotal ? 2 : 1)} />
              </tr>
              <GroupRow
                title="Разница"
                values={report.netTotals}
                total={report.netTotal}
                base={base}
                signed
                showTotal={showTotal}
              />
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Есть ли у строки-родителя подкатегории в этом же списке. */
function hasKids(rows: ReportRow[], row: ReportRow): boolean {
  if (row.depth !== 0) return false;
  return rows.some((r) => r.depth === 1 && r.parent === row.key);
}

function Th({
  children,
  align = "left",
  sticky,
  first,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  sticky?: boolean;
  first?: boolean;
}) {
  return (
    <th
      className={`table-th bg-panel whitespace-nowrap ${
        align === "right" ? "text-right" : ""
      } ${
        // ТОЛЬКО top-0.
        //
        // Здесь стоял отступ на высоту шапки приложения — в расчёте на то, что
        // таблица прокручивается вместе со страницей. Но обёртка таблицы это
        // `overflow-x-auto`, а любой не-`visible` overflow делает блок СВОИМ
        // контейнером прокрутки: `sticky` отсчитывается от него, а не от окна.
        // Прокрутки по вертикали внутри контейнера нет, поэтому заголовки не
        // «прилипали», а просто ВСЕГДА висели на 72px ниже своей строки — и
        // накрывали собой первую строку блока «Доход» (z-30 против z-10 у
        // строк). У человека с зарплатой первой по сумме пропадала ровно она.
        sticky ? "sticky top-0 z-20" : ""
      } ${
        first ? "left-0 z-30 min-w-[15rem]" : ""
      }`}
    >
      {children}
    </th>
  );
}

/** Строка-шапка блока: «Доход», «Расход», «Разница». */
function GroupRow({
  title,
  values,
  total,
  base,
  tone,
  signed,
  showTotal,
}: {
  title: string;
  values: number[];
  total: number;
  base: string;
  tone?: string;
  signed?: boolean;
  showTotal: boolean;
}) {
  return (
    <tr className="bg-panel2 font-semibold">
      <td className="table-td sticky left-0 bg-panel2 z-10">
        <span className={tone}>{title}</span>
      </td>
      {values.map((v, i) => (
        <td key={i} className="table-td text-right tabular-nums whitespace-nowrap">
          <Money value={v} base={base} signed={signed} />
        </td>
      ))}
      {showTotal && (
        <td className="table-td text-right tabular-nums whitespace-nowrap">
          <Money value={total} base={base} signed={signed} />
        </td>
      )}
    </tr>
  );
}

function BodyRow({
  row,
  base,
  columns,
  hidden,
  collapsed,
  hasKids: kids,
  showTotal,
  onToggle,
  onCell,
}: {
  row: ReportRow;
  base: string;
  columns: { key: string; label: string }[];
  hidden: boolean;
  collapsed: boolean;
  hasKids: boolean;
  showTotal: boolean;
  onToggle: () => void;
  onCell: (col: { key: string; label: string } | null) => void;
}) {
  if (hidden) return null;
  return (
    <tr className="group hover:bg-panel2/60">
      <td
        className={`table-td sticky left-0 bg-panel group-hover:bg-panel2 z-10 whitespace-nowrap ${
          row.depth === 1 ? "pl-8 text-muted" : ""
        }`}
      >
        {kids ? (
          <button
            className="inline-flex items-center gap-1 hover:text-accent"
            onClick={onToggle}
            title={collapsed ? "Развернуть" : "Свернуть"}
          >
            {collapsed ? (
              <ChevronRight className="w-3.5 h-3.5" aria-hidden />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" aria-hidden />
            )}
            {row.label}
          </button>
        ) : (
          row.label
        )}
      </td>
      {row.values.map((v, i) => (
        <td key={columns[i].key} className="table-td text-right p-0">
          <Cell value={v} base={base} onClick={() => onCell(columns[i])} />
        </td>
      ))}
      {showTotal && (
        <td className="table-td text-right p-0 font-medium">
          <Cell value={row.total} base={base} onClick={() => onCell(null)} />
        </td>
      )}
    </tr>
  );
}

/** Ячейка суммы: кликабельна, когда есть что показать в детализации. */
function Cell({
  value,
  base,
  onClick,
}: {
  value: number;
  base: string;
  onClick: () => void;
}) {
  if (value === 0) {
    return <span className="block px-3 py-2 text-muted/50">—</span>;
  }
  return (
    <button
      className="block w-full text-right px-3 py-2 tabular-nums whitespace-nowrap hover:text-accent"
      onClick={onClick}
    >
      {formatMoney(value, base)}
    </button>
  );
}

function Money({
  value,
  base,
  signed,
}: {
  value: number;
  base: string;
  signed?: boolean;
}) {
  if (value === 0) return <span className="text-muted/50">—</span>;
  const tone = signed ? (value < 0 ? "text-expense" : "text-income") : "";
  return <span className={tone}>{formatMoney(value, base, { signed })}</span>;
}
