/**
 * Шаблон импорта операций — файл, который приложение выдаёт пользователю.
 *
 * Смысл шаблона не в «правильных заголовках», а в том, что выбор сведён к
 * заведомо принимаемому: в выпадающих списках стоят СВОИ счета, СВОИ категории
 * и СВОИ контрагенты, взятые из живого справочника Дзен-мани. Человек не
 * угадывает написание — он выбирает; а всё, что можно решить за него (валюта у
 * счёта, знак у типа операции), решено заранее и колонкой не спрашивается.
 *
 * Разбор обратной стороны — в `importRows`; здесь только запись.
 */

import { addRangeValidations, sheetRange } from "./xlsxFormulas";
import { sheetPathByName } from "./xlsxCharts";
import { downloadBlob } from "./downloadBlob";

/** Версия шаблона. Растёт, когда меняется состав колонок. */
export const TEMPLATE_VERSION = 1;

/** Маркер в шапке листа «Как заполнять» — по нему узнаём свой файл. */
export const TEMPLATE_MARKER = "DA-XLSX-TEMPLATE";

export const SHEET_OPS = "Операции";
export const SHEET_DICTS = "Справочники";
export const SHEET_EXAMPLES = "Примеры";
export const SHEET_HOWTO = "Как заполнять";

/**
 * Колонки листа «Операции» — они же договор с разбором.
 *
 * Порядок здесь только для записи: при чтении колонки ищутся по тексту шапки,
 * поэтому переставленные и лишние колонки импорт не ломают.
 */
export const OPS_COLUMNS = [
  "Дата",
  "Время",
  "Тип",
  "Категория",
  "Счёт списания",
  "Счёт зачисления",
  "Сумма",
  "Сумма зачисления",
  "Контрагент",
  "Комментарий",
] as const;

export type OpsColumn = (typeof OPS_COLUMNS)[number];

/** Типы операций — ровно те, что понимает разбор. */
export const OP_TYPES = ["Расход", "Доход", "Возврат", "Перевод"] as const;
export type OpTypeLabel = (typeof OP_TYPES)[number];

/** Сколько строк листа накрыты выпадающими списками. */
export const TEMPLATE_ROWS = 1000;

export interface TemplateDicts {
  /** Счета: название, валюта, вид — всё, что нужно, чтобы выбрать осознанно. */
  accounts: { title: string; currency: string; kind: string }[];
  /** Категории полными путями: «Еда / Кафе». */
  categories: string[];
  /** Контрагенты из справочника Дзен-мани. */
  payees: string[];
  /** Валюта отчётов — в шапке, чтобы человек понимал, в чём считается аналитика. */
  base: string;
}

interface Cell {
  value?: string | number | null;
  type?: StringConstructor | NumberConstructor;
  fontWeight?: "bold";
  backgroundColor?: string;
  textColor?: string;
  wrap?: boolean;
  align?: "left" | "center" | "right";
  format?: string;
  span?: number;
  columnSpan?: number;
}

const BG_HEAD = "#EFF3F8";
const TEXT_MUTED = "#64748B";

const head = (v: string): Cell => ({
  value: v,
  type: String,
  fontWeight: "bold",
  backgroundColor: BG_HEAD,
});
const text = (v: string, extra: Partial<Cell> = {}): Cell => ({
  value: v,
  type: String,
  ...extra,
});
const muted = (v: string): Cell => text(v, { textColor: TEXT_MUTED, wrap: true });
const money = (v: number): Cell => ({ value: v, type: Number, format: "#,##0.00" });

/**
 * Листы книги в формате пакета записи.
 *
 * Чистая функция: тест собирает те же данные, что и кнопка, и проверяет их без
 * записи файла.
 */
export interface TemplateSheet {
  data: Cell[][];
  sheet: string;
  columns: { width: number }[];
  stickyRowsCount?: number;
}

export function buildTemplateSheets(
  dicts: TemplateDicts,
  today: string
): TemplateSheet[] {
  const ops: Cell[][] = [OPS_COLUMNS.map((c) => head(c))];

  const dictRows = Math.max(
    dicts.accounts.length,
    dicts.categories.length,
    dicts.payees.length,
    OP_TYPES.length
  );
  const dictsSheet: Cell[][] = [
    [head("Счета"), head("Валюта"), head("Вид"), head("Категории"), head("Контрагенты"), head("Типы операций")],
  ];
  for (let i = 0; i < dictRows; i++) {
    const a = dicts.accounts[i];
    dictsSheet.push([
      text(a?.title ?? ""),
      text(a?.currency ?? ""),
      text(a?.kind ?? ""),
      text(dicts.categories[i] ?? ""),
      text(dicts.payees[i] ?? ""),
      text(OP_TYPES[i] ?? ""),
    ]);
  }

  // Примеры на отдельном листе, а не серым курсивом внутри данных: строку
  // внутри данных кто-нибудь обязательно забудет удалить и отправит в облако.
  const firstAccount = dicts.accounts[0]?.title ?? "Наличные";
  const secondAccount = dicts.accounts[1]?.title ?? firstAccount;
  const someCategory = dicts.categories[0] ?? "Без категории";
  const examples: Cell[][] = [
    OPS_COLUMNS.map((c) => head(c)),
    [text("15.08.2026"), text("09:30"), text("Расход"), text(someCategory), text(firstAccount), text(""), money(1290.5), text(""), text("Пятёрочка"), text("Продукты на неделю")],
    [text("15.08.2026"), text(""), text("Доход"), text(someCategory), text(""), text(firstAccount), money(120000), text(""), text("Работа"), text("Зарплата")],
    [text("16.08.2026"), text(""), text("Возврат"), text(someCategory), text(""), text(firstAccount), money(890), text(""), text("Ozon"), text("Вернули за отменённый заказ")],
    [text("16.08.2026"), text("12:00"), text("Перевод"), text(""), text(firstAccount), text(secondAccount), money(5000), text(""), text(""), text("Перекладываю на накопительный")],
    [text("17.08.2026"), text(""), text("Перевод"), text(""), text(firstAccount), text(secondAccount), money(100), money(9500), text(""), text("Перевод между валютами: сумма зачисления обязательна")],
  ];

  const howto: Cell[][] = [
    [head("Как заполнять"), head("")],
    [text(TEMPLATE_MARKER, { fontWeight: "bold" }), text("Не удаляйте эту ячейку — по ней приложение узнаёт свой шаблон")],
    [text("Версия"), { value: TEMPLATE_VERSION, type: Number }],
    [text("Выгружен"), text(today)],
    [text("Валюта отчётов"), text(dicts.base)],
    [text(""), text("")],
    [text("1."), muted("Заполняйте только лист «Операции». Первая строка — шапка, её не трогайте.")],
    [text("2."), muted("Сумма всегда положительная. Расход это или доход — говорит колонка «Тип».")],
    [text("3."), muted("Валюту указывать не нужно: сумма считается в валюте своего счёта. Валюты счетов — на листе «Справочники».")],
    [text("4."), muted("Категория пишется полным путём через дробь: «Еда / Кафе». Выбирайте из списка — так надёжнее.")],
    [text("5."), muted("У перевода заполняются оба счёта и не заполняется категория. Если счета в разных валютах, укажите ещё «Сумму зачисления».")],
    [text("6."), muted("Долг — это перевод на счёт долгов; в этом случае обязательно укажите контрагента.")],
    [text("7."), muted("Время можно не заполнять — поставим 12:00. После отправки в Дзен-мани время операции уже не изменить.")],
    [text(""), text("")],
    [text("Важно"), muted("В шаблоне ваши счета, категории и контрагенты. Это личный файл — не выкладывайте его в общий доступ.")],
    [text(""), muted("Если справочники в Дзен-мани изменились — скачайте шаблон заново, иначе строки со старыми названиями отобьются.")],
  ];

  const opsColumns = [
    { width: 12 },
    { width: 8 },
    { width: 12 },
    { width: 28 },
    { width: 22 },
    { width: 22 },
    { width: 14 },
    { width: 16 },
    { width: 22 },
    { width: 40 },
  ];
  return [
    { data: ops, sheet: SHEET_OPS, columns: opsColumns, stickyRowsCount: 1 },
    {
      data: dictsSheet,
      sheet: SHEET_DICTS,
      columns: [
        { width: 24 },
        { width: 10 },
        { width: 16 },
        { width: 32 },
        { width: 26 },
        { width: 14 },
      ],
      stickyRowsCount: 1,
    },
    { data: examples, sheet: SHEET_EXAMPLES, columns: opsColumns, stickyRowsCount: 1 },
    { data: howto, sheet: SHEET_HOWTO, columns: [{ width: 18 }, { width: 90 }] },
  ];
}

/**
 * Выпадающие списки листа «Операции» — ссылками на справочник.
 *
 * У счетов, категорий и типа проверка жёсткая: значение вне списка Дзен-мани
 * всё равно не примет, и честнее сказать об этом сразу в Excel. У контрагента
 * мягкая — вписать нового законно.
 */
export function opsValidations(dicts: TemplateDicts): {
  sqref: string;
  range: string;
  hard?: boolean;
}[] {
  const last = TEMPLATE_ROWS + 1;
  const rows = (col: string, count: number) =>
    sheetRange(SHEET_DICTS, `$${col}$2`, `$${col}$${Math.max(2, count + 1)}`);
  return [
    { sqref: `C2:C${last}`, range: rows("F", OP_TYPES.length) },
    { sqref: `D2:D${last}`, range: rows("D", dicts.categories.length) },
    { sqref: `E2:E${last}`, range: rows("A", dicts.accounts.length) },
    { sqref: `F2:F${last}`, range: rows("A", dicts.accounts.length) },
    { sqref: `I2:I${last}`, range: rows("E", dicts.payees.length), hard: false },
  ];
}

/**
 * Собрать и отдать шаблон.
 *
 * Пакет-писатель и распаковщик подгружаются динамически — они нужны раз в жизни
 * по кнопке и в стартовом бандле им делать нечего.
 */
export async function exportImportTemplate(
  dicts: TemplateDicts,
  today: string
): Promise<void> {
  const sheets = buildTemplateSheets(dicts, today);
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const blob = await writeXlsxFile(sheets as never).toBlob();

  const { unzipSync, zipSync, strFromU8, strToU8 } = await import("fflate");
  const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const files: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(zip)) {
    if (name.endsWith(".xml") || name.endsWith(".rels")) files[name] = strFromU8(bytes);
  }
  const opsPath = sheetPathByName(files, SHEET_OPS);
  zip[opsPath] = strToU8(addRangeValidations(files[opsPath], opsValidations(dicts)));

  downloadBlob(
    new Blob([zipSync(zip)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `dzenanalytics-import-${today}.xlsx`
  );
}
