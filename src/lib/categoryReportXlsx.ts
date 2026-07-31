/**
 * Выгрузка отчёта «доходы и расходы по категориям» в отформатированный Excel
 * (issue #54).
 *
 * Лист повторяет то, что видно на экране: шапка с периодами, блок «Доход»,
 * блок «Расход», строка «Разница». Подкатегории — с отступом под родителем,
 * суммы — числами с денежным форматом (не текстом), поэтому в Excel по ним
 * сразу считаются формулы и строятся диаграммы. Первая строка и первый столбец
 * закреплены — иначе на истории в несколько лет таблица нечитаема.
 */

import type { CategoryReport, ReportRow } from "./categoryReport";

/** Тип ячейки листа. Повторяет форму, которую ждёт write-excel-file, но не
 *  тянет пакет в основной бандл — сам пакет подгружается только при выгрузке. */
export interface XlsxCell {
  value?: string | number | null;
  type?: StringConstructor | NumberConstructor;
  fontWeight?: "bold";
  backgroundColor?: string;
  textColor?: string;
  align?: "left" | "center" | "right";
  indent?: number;
  format?: string;
  borderColor?: string;
  bottomBorderStyle?: "thin";
}

export type XlsxRow = (XlsxCell | null)[];

const HEADER_BG = "#E8F0E4";
const GROUP_BG = "#F3F4F6";

/** Денежный формат Excel для базовой валюты: рубли — со знаком, остальные —
 *  с кодом валюты, чтобы не гадать про символ. */
export function moneyFormat(baseCurrency: string): string {
  const suffix = baseCurrency === "RUB" ? '" ₽"' : `" ${baseCurrency}"`;
  return `#,##0.00${suffix}`;
}

function money(value: number, format: string, opts: Partial<XlsxCell> = {}): XlsxCell {
  return { value, type: Number, format, align: "right", ...opts };
}

function rowCells(
  row: ReportRow,
  format: string,
  showTotal: boolean,
  extra: Partial<XlsxCell> = {}
): XlsxRow {
  return [
    { value: row.label, type: String, indent: row.depth, ...extra },
    ...row.values.map((v) => money(v, format, extra)),
    ...(showTotal ? [money(row.total, format, { fontWeight: "bold", ...extra })] : []),
  ];
}

/**
 * Собрать данные листа. Вынесено отдельно от записи файла, чтобы структуру
 * можно было проверить тестом, не создавая настоящий .xlsx.
 */
export function buildReportSheet(
  report: CategoryReport,
  baseCurrency: string
): XlsxRow[] {
  const fmt = moneyFormat(baseCurrency);
  // При единственном столбце «Итого» дублировал бы его — как и на экране.
  const showTotal = report.columns.length > 1;
  const header: XlsxRow = [
    { value: "Категория", type: String, fontWeight: "bold", backgroundColor: HEADER_BG },
    ...report.columns.map((c) => ({
      value: c.label,
      type: String as StringConstructor,
      fontWeight: "bold" as const,
      backgroundColor: HEADER_BG,
      align: "right" as const,
    })),
    ...(showTotal
      ? [
          {
            value: "Итого",
            type: String as StringConstructor,
            fontWeight: "bold" as const,
            backgroundColor: HEADER_BG,
            align: "right" as const,
          },
        ]
      : []),
  ];

  const groupRow = (title: string, values: number[], total: number): XlsxRow => [
    { value: title, type: String, fontWeight: "bold", backgroundColor: GROUP_BG },
    ...values.map((v) =>
      money(v, fmt, { fontWeight: "bold", backgroundColor: GROUP_BG })
    ),
    ...(showTotal
      ? [money(total, fmt, { fontWeight: "bold", backgroundColor: GROUP_BG })]
      : []),
  ];

  const blank: XlsxRow = new Array(report.columns.length + (showTotal ? 2 : 1)).fill(
    null
  );

  return [
    header,
    groupRow("Доход", report.incomeTotals, report.incomeTotal),
    ...report.income.map((r) => rowCells(r, fmt, showTotal)),
    blank,
    groupRow("Расход", report.expenseTotals, report.expenseTotal),
    ...report.expense.map((r) => rowCells(r, fmt, showTotal)),
    blank,
    groupRow("Разница", report.netTotals, report.netTotal),
  ];
}

/** Ширины столбцов: первый — под названия категорий, остальные — под суммы. */
export function sheetColumns(report: CategoryReport): { width: number }[] {
  const total = report.columns.length > 1 ? [{ width: 18 }] : [];
  return [{ width: 34 }, ...report.columns.map(() => ({ width: 16 })), ...total];
}

/**
 * Записать и отдать файл пользователю. Пакет-писатель подгружается динамически:
 * он нужен раз в жизни по кнопке и не должен лежать в стартовом бандле.
 */
export async function exportCategoryReportXlsx(
  report: CategoryReport,
  baseCurrency: string,
  fileName: string
): Promise<void> {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const file = writeXlsxFile(buildReportSheet(report, baseCurrency) as never, {
    sheet: "Доходы и расходы",
    columns: sheetColumns(report),
    // Шапка и колонка категорий всегда на виду при прокрутке.
    stickyRowsCount: 1,
    stickyColumnsCount: 1,
  });
  await file.toFile(fileName);
}
