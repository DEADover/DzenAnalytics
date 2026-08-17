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
import { downloadBlob } from "./downloadBlob";

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

// Заливки строк-заголовков. Шапка нейтральная, а блоки окрашены по смыслу —
// как на экране, где «Доход» зелёный, а «Расход» красный. Тона намеренно
// бледные: по этим строкам идут суммы, и насыщенный фон их бы забивал.
const HEADER_BG = "#F3F4F6";
const INCOME_BG = "#E6F4EA";
const EXPENSE_BG = "#FCE8E6";
/** «Разница» — не доход и не расход, поэтому остаётся нейтральной. */
const NET_BG = "#F3F4F6";

/** Как выгружать суммы: со знаком валюты или голым числом. */
export type XlsxNumberStyle = "money" | "plain";

export const NUMBER_STYLE_LABELS: Record<XlsxNumberStyle, string> = {
  money: "С валютой",
  plain: "Числом",
};

/**
 * Формат чисел в Excel.
 *
 * `money` — рубли со знаком, остальные валюты с кодом (символ угадывать не
 * будем). `plain` — просто число с двумя знаками: в таком виде суммы удобнее
 * тащить в свои формулы и сводные, а знак валюты там только мешает. В обоих
 * случаях в ячейке лежит ЧИСЛО, отличается только отображение.
 */
export function moneyFormat(
  baseCurrency: string,
  style: XlsxNumberStyle = "money"
): string {
  if (style === "plain") return "#,##0.00";
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
  baseCurrency: string,
  style: XlsxNumberStyle = "money"
): XlsxRow[] {
  const fmt = moneyFormat(baseCurrency, style);
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

  const groupRow = (
    title: string,
    values: number[],
    total: number,
    backgroundColor: string
  ): XlsxRow => [
    { value: title, type: String, fontWeight: "bold", backgroundColor },
    ...values.map((v) => money(v, fmt, { fontWeight: "bold", backgroundColor })),
    ...(showTotal
      ? [money(total, fmt, { fontWeight: "bold", backgroundColor })]
      : []),
  ];

  const blank: XlsxRow = new Array(report.columns.length + (showTotal ? 2 : 1)).fill(
    null
  );

  return [
    header,
    groupRow("Доход", report.incomeTotals, report.incomeTotal, INCOME_BG),
    ...report.income.map((r) => rowCells(r, fmt, showTotal)),
    blank,
    groupRow("Расход", report.expenseTotals, report.expenseTotal, EXPENSE_BG),
    ...report.expense.map((r) => rowCells(r, fmt, showTotal)),
    blank,
    groupRow("Разница", report.netTotals, report.netTotal, NET_BG),
  ];
}

/** Ширины столбцов: первый — под названия категорий, остальные — под суммы. */
export function sheetColumns(report: CategoryReport): { width: number }[] {
  const total = report.columns.length > 1 ? [{ width: 18 }] : [];
  return [{ width: 34 }, ...report.columns.map(() => ({ width: 16 })), ...total];
}

// ── Сворачивание подкатегорий в Excel ────────────────────────────────────────
//
// Excel умеет группировать строки — те самые плюсики на левом поле, которыми
// подкатегории сворачиваются под своей категорией. `write-excel-file` этого не
// поддерживает вовсе: у строки в его модели нет НИ ОДНОГО свойства, только
// массив ячеек. Менять писателя ради одной возможности дорого — ближайший
// вариант с группировкой (exceljs) в бандле на порядок тяжелее, а в
// standalone-сборке динамические импорты инлайнятся, и один HTML-файл потолстел
// бы примерно на мегабайт.
//
// Поэтому дописываем группировку поверх готового файла: xlsx — это zip с XML,
// строке достаточно атрибута `outlineLevel`. Патч завязан на форму разметки, и
// чтобы это не превратилось в тихую поломку при обновлении библиотеки, он
// СЧИТАЕТ пропатченные строки и падает, если нашёл не все.

/**
 * Номера строк листа (как их нумерует Excel, с единицы), которые нужно убрать
 * под плюсик, — это подкатегории.
 *
 * Порядок строк повторяет `buildReportSheet`; тест проверяет, что эти два места
 * не разъехались, сверяя отступ у каждой найденной строки.
 */
export function outlineRowNumbers(report: CategoryReport): number[] {
  const out: number[] = [];
  // 1 — шапка, 2 — «Доход», дальше блок доходов.
  const INCOME_START = 3;
  report.income.forEach((r, i) => {
    if (r.depth === 1) out.push(INCOME_START + i);
  });
  // После доходов: пустая строка и «Расход».
  const expenseStart = INCOME_START + report.income.length + 2;
  report.expense.forEach((r, i) => {
    if (r.depth === 1) out.push(expenseStart + i);
  });
  return out;
}

/**
 * Проставить в разметке листа группировку указанным строкам.
 *
 * `summaryBelow="0"` — потому что итоговая строка (категория) у нас стоит НАД
 * своими подкатегориями. Без этого Excel ищет итог снизу и рисует скобку не там.
 *
 * Бросает, если нашлись не все ожидаемые строки: лучше честная ошибка с
 * понятным текстом, чем молча выгруженный файл без плюсиков.
 */
export function addRowOutline(sheetXml: string, rowNumbers: number[]): string {
  if (rowNumbers.length === 0) return sheetXml;
  let xml = sheetXml;
  if (!xml.includes("<sheetPr")) {
    // `sheetPr` по схеме идёт первым потомком `worksheet`.
    xml = xml.replace(
      /(<worksheet\b[^>]*>)/,
      '$1<sheetPr><outlinePr summaryBelow="0"/></sheetPr>'
    );
  }
  const wanted = new Set(rowNumbers);
  let patched = 0;
  xml = xml.replace(/<row r="(\d+)"/g, (match, n: string) => {
    if (!wanted.has(Number(n))) return match;
    patched++;
    return `${match} outlineLevel="1"`;
  });
  if (patched !== wanted.size) {
    throw new Error(
      `группировка строк: ожидали ${wanted.size}, разметили ${patched}`
    );
  }
  return xml;
}

/** Достать лист из xlsx, проставить группировку, собрать файл обратно. */
async function withRowOutline(blob: Blob, rowNumbers: number[]): Promise<Blob> {
  if (rowNumbers.length === 0) return blob;
  const { unzipSync, zipSync, strFromU8, strToU8 } = await import("fflate");
  const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const sheetPath = Object.keys(zip).find((name) =>
    /^xl\/worksheets\/sheet\d+\.xml$/.test(name)
  );
  if (!sheetPath) throw new Error("группировка строк: лист не найден в файле");
  zip[sheetPath] = strToU8(addRowOutline(strFromU8(zip[sheetPath]), rowNumbers));
  return new Blob([zipSync(zip)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/**
 * Записать и отдать файл пользователю. Пакет-писатель подгружается динамически:
 * он нужен раз в жизни по кнопке и не должен лежать в стартовом бандле.
 */
export async function exportCategoryReportXlsx(
  report: CategoryReport,
  baseCurrency: string,
  fileName: string,
  style: XlsxNumberStyle = "money"
): Promise<void> {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const file = writeXlsxFile(buildReportSheet(report, baseCurrency, style) as never, {
    sheet: "Доходы и расходы",
    columns: sheetColumns(report),
    // Шапка и колонка категорий всегда на виду при прокрутке.
    stickyRowsCount: 1,
    stickyColumnsCount: 1,
  });
  // Забираем файл содержимым, а не сразу на диск: подкатегории надо ещё убрать
  // под плюсики — этого писатель не умеет (см. `withRowOutline`).
  const blob = await withRowOutline(await file.toBlob(), outlineRowNumbers(report));
  downloadBlob(blob, fileName);
}
