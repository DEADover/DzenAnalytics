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

import {
  addRangeValidations,
  forceRecalc,
  insertColumnFormulas,
  sheetRange,
} from "./xlsxFormulas";
import { sheetPathByName } from "./xlsxCharts";
import { noteParts, type SheetNote } from "./xlsxNotes";
import { applyColumnFormats, type ColumnFormat } from "./xlsxColumns";
import { downloadBlob } from "./downloadBlob";

/** Версия шаблона. Растёт, когда меняется состав колонок. */
export const TEMPLATE_VERSION = 2;

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

/**
 * Что написано в заметке на ячейке шапки.
 *
 * Раньше это же стояло припиской прямо в названии колонки — и лезло за её
 * ширину, разъезжаясь по всей шапке. Заметка — штатный способ Excel: красный
 * уголок в углу ячейки, текст по наведению, а название остаётся названием.
 */
export const OPS_NOTES: Record<OpsColumn, string> = {
  Дата: "Дата операции: 30.12.2026. Колонка уже в этом формате — набранное Excel приведёт к нему сам.",
  Время:
    "Можно не заполнять: поставим 12:00. После отправки в Дзен-мани время операции изменить уже нельзя.",
  Тип: "Расход, Доход, Возврат или Перевод — выбирается из списка. Тип задаёт и направление денег, и то, какие колонки нужны.",
  Категория:
    "Полный путь через дробь: «Еда / Кафе». Нужна расходу, доходу и возврату. У перевода категории нет — оставьте пусто.",
  "Счёт списания": "Откуда ушли деньги. Заполняется у расхода и у перевода.",
  "Счёт зачисления": "Куда пришли деньги. Заполняется у дохода, возврата и перевода.",
  Сумма:
    "Всегда положительная: направление задаёт колонка «Тип». Валюту указывать не нужно — она берётся у счёта.",
  "Сумма зачисления":
    "Только для перевода между счетами в разных валютах: сколько пришло на счёт зачисления.",
  Контрагент:
    "Магазин, работодатель, человек. Необязательно — кроме долга: долг это перевод на счёт долгов, и там контрагент обязателен. Нет нужного в списке — впишите своё: заведём запись в справочнике вместе с операцией.",
  Комментарий: "Свободный текст. Хэштеги из комментария приложение подхватит.",
};

/** Заметка на колонке проверки — она не из шаблона данных, и это стоит сказать. */
const CHECK_NOTE =
  "Формула проверяет строку по тем же правилам, что и приложение. «Готово» — строку примут; иначе написано, что поправить. При загрузке колонка не читается, удалять её не нужно.";

/** Колонка с формулой-проверкой — сразу за данными. */
export const CHECK_COLUMN = "Проверка";
const CHECK_AT = "K";

/** Заметки шапки листа «Операции»: по одной на колонку, включая проверку. */
export function opsNotes(): SheetNote[] {
  return [
    ...OPS_COLUMNS.map((col, i) => ({
      ref: `${String.fromCharCode(65 + i)}1`,
      title: col,
      text: OPS_NOTES[col],
    })),
    { ref: `${CHECK_AT}1`, title: CHECK_COLUMN, text: CHECK_NOTE },
  ];
}

/**
 * Оформление колонок листа с операциями.
 *
 * Ячеек под данные ещё нет — оформление наследуется от колонки, поэтому дата,
 * набранная в пустой строке, сразу встанет как 30.12.2026, а сумма — по
 * правому краю с разделителем разрядов.
 */
export function opsColumnFormats(): ColumnFormat[] {
  return [
    { column: 1, align: "center", numFmt: "DD.MM.YYYY" },
    { column: 2, align: "center", numFmt: "HH:MM" },
    { column: 3, align: "center" },
    { column: 4, align: "left" },
    { column: 5, align: "left" },
    { column: 6, align: "left" },
    { column: 7, align: "right", numFmt: "#,##0.00" },
    { column: 8, align: "right", numFmt: "#,##0.00" },
    { column: 9, align: "left" },
    { column: 10, align: "left" },
    { column: 11, align: "left" },
  ];
}

/**
 * Формула колонки «Проверка» для строки листа.
 *
 * Те же правила, что у разбора при загрузке, только на языке Excel: человек
 * видит ошибку сразу, а не после загрузки файла. Порядок проверок тот же —
 * сначала незаполненное, потом несочетаемое. Пустая строка молчит.
 *
 * Имена функций английские: в файле они всегда такие, локализованные Excel
 * подставляет сам при показе.
 */
export function checkFormula(row: number): string {
  const r = row;
  const types = sheetRange(SHEET_DICTS, "$F$2", `$F$${OP_TYPES.length + 1}`);
  const q = (v: string) => `"${v}"`;
  const isTransfer = `C${r}="Перевод"`;
  const isIncoming = `OR(C${r}="Доход",C${r}="Возврат")`;
  const branches: [string, string][] = [
    [`COUNTA(A${r}:J${r})=0`, ""],
    [`A${r}=""`, "Не заполнена дата"],
    [`C${r}=""`, "Не заполнен тип"],
    [`COUNTIF(${types},C${r})=0`, `Тип не из списка: ${OP_TYPES.join(", ")}`],
    [`NOT(ISNUMBER(G${r}))`, "Сумма должна быть числом"],
    [`G${r}<=0`, "Сумма пишется без минуса"],
    [`AND(${isTransfer},D${r}<>"")`, "У перевода категория не заполняется"],
    [`AND(${isTransfer},OR(E${r}="",F${r}=""))`, "У перевода нужны оба счёта"],
    [`AND(${isTransfer},E${r}=F${r})`, "Перевод на тот же счёт"],
    [`AND(C${r}="Расход",E${r}="")`, "У расхода нужен счёт списания"],
    [`AND(C${r}="Расход",F${r}<>"")`, "У расхода счёт зачисления не заполняется"],
    [`AND(${isIncoming},F${r}="")`, "Нужен счёт зачисления"],
    [`AND(${isIncoming},E${r}<>"")`, "Счёт списания — только у расхода и перевода"],
    [`AND(C${r}<>"Перевод",H${r}<>"")`, "Сумма зачисления — только у перевода"],
  ];
  return (
    branches.map(([cond, msg]) => `IF(${cond},${q(msg)},`).join("") +
    q("Готово") +
    ")".repeat(branches.length)
  );
}

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
  alignVertical?: "top" | "center" | "bottom";
  format?: string;
  height?: number;
  span?: number;
  columnSpan?: number;
}

const BG_HEAD = "#EFF3F8";
const TEXT_MUTED = "#64748B";

const head = (v: string, extra: Partial<Cell> = {}): Cell => ({
  value: v,
  type: String,
  fontWeight: "bold",
  backgroundColor: BG_HEAD,
  align: "center",
  alignVertical: "center",
  // Высота задаётся ячейкой, но применяется ко всей строке: шапка получается
  // заметно отдельной от данных, без разделительных линий.
  height: 24,
  ...extra,
});
const text = (v: string, extra: Partial<Cell> = {}): Cell => ({
  value: v,
  type: String,
  ...extra,
});
/**
 * Ячейка листа-инструкции.
 *
 * Слева по горизонтали и по центру по высоте: строки там разной высоты —
 * длинное правило переносится на две-три, — и при обычном выравнивании по
 * нижнему краю номер пункта оказывался под своим текстом, а не напротив него.
 */
const note = (v: string, extra: Partial<Cell> = {}): Cell =>
  text(v, { align: "left", alignVertical: "center", ...extra });
const muted = (v: string): Cell => note(v, { textColor: TEXT_MUTED, wrap: true });
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
  // Лист данных пуст: только шапка. Подсказки живут заметками на её ячейках,
  // подробности — на листе «Как заполнять». Текстом в ячейках их писать нельзя:
  // это лист, куда человек вставляет свои строки, и любая наша строка тут
  // мешает — что вставке, что глазам.
  const ops: Cell[][] = [[...OPS_COLUMNS.map((c) => head(c)), head(CHECK_COLUMN)]];

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
  // Ячейки примеров оформляем так же, как колонки: у написанных пакетом ячеек
  // своё оформление, и без этого дата на «Примерах» стояла бы иначе, чем на
  // «Операциях» — две таблицы одной формы выглядели бы разными.
  const mid = (v: string): Cell => text(v, { align: "center" });
  const examples: Cell[][] = [
    OPS_COLUMNS.map((c) => head(c)),
    [mid("15.08.2026"), mid("09:30"), mid("Расход"), text(someCategory), text(firstAccount), text(""), money(1290.5), text(""), text("Пятёрочка"), text("Продукты на неделю")],
    [mid("15.08.2026"), mid(""), mid("Доход"), text(someCategory), text(""), text(firstAccount), money(120000), text(""), text("Работа"), text("Зарплата")],
    [mid("16.08.2026"), mid(""), mid("Возврат"), text(someCategory), text(""), text(firstAccount), money(890), text(""), text("Ozon"), text("Вернули за отменённый заказ")],
    [mid("16.08.2026"), mid("12:00"), mid("Перевод"), text(""), text(firstAccount), text(secondAccount), money(5000), text(""), text(""), text("Перекладываю на накопительный")],
    [mid("17.08.2026"), mid(""), mid("Перевод"), text(""), text(firstAccount), text(secondAccount), money(100), money(9500), text(""), text("Перевод между валютами: сумма зачисления обязательна")],
  ];

  const howto: Cell[][] = [
    [head("Как заполнять", { align: "left" }), head("", { align: "left" })],
    [note(TEMPLATE_MARKER, { fontWeight: "bold" }), muted("Не удаляйте эту ячейку — по ней приложение узнаёт свой шаблон")],
    [note("Версия"), { value: TEMPLATE_VERSION, type: Number, align: "left", alignVertical: "center" }],
    [note("Выгружен"), note(today)],
    [note("Валюта отчётов"), note(dicts.base)],
    [note(""), note("")],
    [note("1."), muted("Заполняйте только лист «Операции». Первая строка — шапка, её не трогайте.")],
    [note("2."), muted("Сумма всегда положительная. Расход это или доход — говорит колонка «Тип».")],
    [note("3."), muted("Валюту указывать не нужно: сумма считается в валюте своего счёта. Валюты счетов — на листе «Справочники».")],
    [note("4."), muted("Категория пишется полным путём через дробь: «Еда / Кафе». Выбирайте из списка — так надёжнее.")],
    [note("5."), muted("У перевода заполняются оба счёта и не заполняется категория. Если счета в разных валютах, укажите ещё «Сумму зачисления».")],
    [note("6."), muted("Долг — это перевод на счёт долгов; в этом случае обязательно укажите контрагента.")],
    [note("7."), muted("Контрагента можно вписать своего — нет такого в списке, заведём запись в справочнике вместе с операциями.")],
    [note("8."), muted("Время можно не заполнять — поставим 12:00. После отправки в Дзен-мани время операции уже не изменить.")],
    [note("9."), muted("На листе «Операции» у каждой колонки есть заметка: наведите на её название — там написано, для каких типов операций она нужна.")],
    [note(""), note("")],
    [note("Важно"), muted("В шаблоне ваши счета, категории и контрагенты. Это личный файл — не выкладывайте его в общий доступ.")],
    [note(""), muted("Если справочники в Дзен-мани изменились — скачайте шаблон заново, иначе строки со старыми названиями отобьются.")],
  ];

  // Ширины — по самому длинному, что в колонке бывает: названию колонки или
  // значению из справочника. Категории и счета берём по факту, иначе «Аренда
  // квартиры / Коммуналка» уезжает под соседнюю колонку.
  const widest = (values: string[], min: number, max: number) =>
    Math.min(max, Math.max(min, ...values.map((v) => v.length + 3)));
  const opsColumns = [
    { width: 12 },
    { width: 10 },
    { width: 12 },
    { width: widest(dicts.categories, 18, 34) },
    { width: widest(dicts.accounts.map((a) => a.title), 18, 26) },
    { width: widest(dicts.accounts.map((a) => a.title), 20, 26) },
    { width: 14 },
    { width: 18 },
    { width: widest(dicts.payees, 18, 26) },
    { width: 36 },
  ];
  const opsWithCheck = [...opsColumns, { width: 46 }];
  return [
    { data: ops, sheet: SHEET_OPS, columns: opsWithCheck, stickyRowsCount: 1 },
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
  const bytes = await patchTemplateBook(new Uint8Array(await blob.arrayBuffer()), dicts);

  downloadBlob(
    new Blob([bytes as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `dzenanalytics-import-${today}.xlsx`
  );
}

/**
 * Дописать в готовую книгу то, чего писатель не умеет: формулы и списки.
 *
 * Отдельно от `exportImportTemplate` ради теста: писатель в браузере и в Node —
 * разные пакеты, а вот эта, единственная содержательная часть должна быть одной
 * и той же. Иначе тест проверял бы свою копию правки, а не ту, что уезжает
 * человеку.
 */
export async function patchTemplateBook(
  book: Uint8Array,
  dicts: TemplateDicts
): Promise<Uint8Array> {
  const { unzipSync, zipSync, strFromU8, strToU8 } = await import("fflate");
  const zip = unzipSync(book);
  const files: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(zip)) {
    if (name.endsWith(".xml") || name.endsWith(".rels")) files[name] = strFromU8(bytes);
  }
  const opsPath = sheetPathByName(files, SHEET_OPS);
  zip[opsPath] = strToU8(
    addRangeValidations(
      insertColumnFormulas(files[opsPath], {
        column: CHECK_AT,
        from: 2,
        to: TEMPLATE_ROWS + 1,
        formula: checkFormula,
        shared: true,
      }),
      opsValidations(dicts)
    )
  );
  // Формулы приходят без посчитанных значений: пока строка пуста, считать
  // нечего. Без этого флага Excel показал бы пустую колонку до первой правки.
  if (files["xl/workbook.xml"])
    zip["xl/workbook.xml"] = strToU8(forceRecalc(files["xl/workbook.xml"]));

  // Оформление колонок — и на листе данных, и на примерах: они одной формы, и
  // разное оформление читалось бы как разные таблицы.
  let styles = files["xl/styles.xml"];
  for (const sheet of [SHEET_OPS, SHEET_EXAMPLES]) {
    const path = sheetPathByName(files, sheet);
    const current = strFromU8(zip[path]);
    const done = applyColumnFormats(styles, current, opsColumnFormats());
    styles = done.styles;
    zip[path] = strToU8(done.sheet);
  }
  zip["xl/styles.xml"] = strToU8(styles);

  // Заметки — последними: они дописывают лист, стили и типы содержимого.
  const withCols: Record<string, string> = { ...files };
  for (const name of Object.keys(zip))
    if (name.endsWith(".xml") || name.endsWith(".rels")) withCols[name] = strFromU8(zip[name]);
  for (const [name, xml] of Object.entries(noteParts(withCols, SHEET_OPS, opsNotes())))
    zip[name] = strToU8(xml);

  return zipSync(zip);
}
