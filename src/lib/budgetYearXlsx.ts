/**
 * Годовой отчёт по бюджету в Excel — с нативными диаграммами.
 *
 * Книга из четырёх листов:
 *   «Дашборд»          — сводные показатели и десять диаграмм;
 *   «По месяцам»       — план · факт · разница по каждому из двенадцати месяцев,
 *                        подкатегории убраны под плюсики;
 *   «Год к году»       — тот же отрезок этого и прошлого года со сравнением;
 *   «Данные диаграмм»  — источник для диаграмм, открыто и проверяемо.
 *
 * Диаграммы настоящие, а не картинки: правите цифру на листе — перерисовывается
 * столбик. Ради этого файл после записи дополняется частями OOXML вручную
 * (см. `xlsxCharts`), потому что писатель диаграмм не умеет.
 */

import { addRowOutline, type XlsxNumberStyle } from "./categoryReportXlsx";
import {
  achievement,
  atMonth,
  buildBudgetDashboard,
  growth,
  prevMonth,
  variance,
  ytd,
  type BudgetDashboard,
} from "./budgetDashboard";
import {
  hasTransfers,
  yearDiff,
  type BudgetYearReport,
  type YearCell,
  type YearRow,
  type YearSection,
} from "./budgetYear";
import { TRANSFER_CATEGORY } from "./budgetScope";
import { monthLabelFull } from "./format";
import { columnLetter, injectCharts, sheetPathByName, type ChartSpec } from "./xlsxCharts";
import {
  addListValidation,
  cellRef,
  forceRecalc,
  setFormulas,
} from "./xlsxFormulas";

export interface XlsxCell {
  value?: string | number | null;
  type?: StringConstructor | NumberConstructor;
  fontWeight?: "bold";
  fontSize?: number;
  backgroundColor?: string;
  textColor?: string;
  align?: "left" | "center" | "right";
  alignVertical?: "top" | "center" | "bottom";
  indent?: number;
  format?: string;
  columnSpan?: number;
  height?: number;
  wrap?: boolean;
  borderColor?: string;
  leftBorderStyle?: "thin";
  leftBorderColor?: string;
  bottomBorderStyle?: "thin";
  bottomBorderColor?: string;
}

type Row = (XlsxCell | null)[];

// ── Палитра ──────────────────────────────────────────────────────────────────
// Те же смыслы, что на экране: факт — акцентный бирюзовый, план — янтарный,
// «хорошо» зелёное, «плохо» красное. Тона взяты из светлой темы приложения,
// чтобы выгрузка не выглядела файлом из другого продукта.
//
// Внимание на решётку: в разметке диаграмм цвет пишется голыми шестью знаками
// (`<a:srgbClr val="0891B2"/>`), а писатель ячеек требует именно `#0891B2` и
// падает без неё. Поэтому наборы разные — это не небрежность.
const C_FACT = "0891B2";
const C_PLAN = "F59E0B";
const C_GOOD = "16A34A";
const C_BAD = "DC2626";
const C_REST = "E5E7EB";
const BG_HEAD = "#F3F4F6";
const BG_INCOME = "#E6F4EA";
const BG_EXPENSE = "#FCE8E6";
const BG_NEUTRAL = "#F3F4F6";
const BORDER = "#D1D5DB";
const TEXT_MUTED = "#6B7280";
const TEXT_SUB = "#4B5563";

const SHEET_DASH = "Дашборд";
const SHEET_MONTHS = "По месяцам";
const SHEET_YOY = "Год к году";
const SHEET_DATA = "Данные диаграмм";

// Разделитель дробной части в КОДЕ формата всегда точка — локаль подставляет
// запятую уже при показе. Запятая внутри кода сломала бы формат.
const PCT_FORMAT = "0.0%";

/**
 * Денежный формат бюджета — БЕЗ копеек, в отличие от отчёта «Доходы и расходы».
 *
 * Бюджет живёт в круглых суммах: план ставят на «45 000», а не на «45 000,00».
 * Две лишние цифры в каждой из сорока колонок помесячной таблицы и в подписи
 * каждого столбика на диаграмме — это шум, из-за которого не видно самих чисел.
 */
export function budgetFormat(baseCurrency: string, style: XlsxNumberStyle = "money"): string {
  if (style === "plain") return "#,##0";
  return baseCurrency === "RUB" ? '#,##0" ₽"' : `#,##0" ${baseCurrency}"`;
}


function text(value: string, extra: Partial<XlsxCell> = {}): XlsxCell {
  return { value, type: String, ...extra };
}

function num(value: number | null, format: string, extra: Partial<XlsxCell> = {}): XlsxCell {
  // `null` — это «показателя нет» (плана нет, базы для роста нет). Пустая
  // ячейка честнее нуля: ноль в Excel попадёт в СУММ и в диаграмму.
  if (value === null || !Number.isFinite(value)) return { value: null, type: Number, format };
  return { value, type: Number, format, align: "right", ...extra };
}

// ── Лист «Данные диаграмм» ───────────────────────────────────────────────────
//
// Лист устроен так, чтобы месяц можно было переключать прямо в Excel. Слева —
// видимые показатели, и все они ФОРМУЛЫ; справа — сырьё по двенадцати месяцам,
// из которого они считаются. Номер выбранного месяца лежит в одной ячейке
// «Дашборда», и от неё зависит весь лист, а значит и диаграммы.

/** Первая строка с данными (после шапки), нумерация Excel — с единицы. */
const DATA_FIRST_ROW = 2;

/** Колонки листа «Данные диаграмм», 0-инд. */
const D = {
  label: 0,
  factMonth: 1,
  planMonth: 2,
  varMonth: 3,
  growthMonth: 4,
  factYtd: 5,
  planYtd: 6,
  varYtd: 7,
  growthYtd: 8,
  /** Сырьё: по двенадцать колонок на блок. */
  rawFact: 9,
  rawPlan: 21,
  rawPrev: 33,
  /** Служебные: их считает Excel, руками их не читают. */
  prevMonthFact: 45,
  prevYtdFact: 46,
  prevMonthYear: 47,
} as const;

const MONTH_NAMES = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

const MONTH_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** Ячейка «Дашборда» с номером выбранного месяца — от неё зависит весь отчёт. */
const MONTH_CELL = "Дашборд!$P$2";

interface DonutBlock {
  /** Номер строки первой доли. */
  firstRow: number;
  labels: string[];
  values: number[];
  colors: string[];
}

/** Строка листа данных: где она лежит и по какому знаку считать отклонение. */
interface DataRowRef {
  row: number;
  kind: "expense" | "income";
}

interface DataSheet {
  rows: Row[];
  /** Формулы листа: адрес → формула без ведущего «=». */
  formulas: Map<string, string>;
  /** Строки итогов, на которые ссылаются показатели «Дашборда». */
  totals: {
    expense: DataRowRef;
    expenseAll: DataRowRef | null;
    income: DataRowRef;
    incomeAll: DataRowRef | null;
    delta: DataRowRef;
  };
  donutMonth: DonutBlock;
  donutYtd: DonutBlock;
}

/**
 * Три доли бублика «выполнение плана»: освоено, перерасход, остаток.
 *
 * Одной долей «факт» и одной «остаток» обойтись нельзя: при перерасходе остаток
 * уходит в минус, и бублик из круговой диаграммы превращается в кашу. Так же
 * считает и месячная карточка на экране.
 */
export function planSlices(fact: number, plan: number): { labels: string[]; values: number[]; colors: string[] } {
  const used = Math.max(0, Math.min(fact, plan));
  const over = Math.max(0, fact - plan);
  const left = Math.max(0, plan - fact);
  return {
    labels: ["Освоено", "Перерасход", "Остаток"],
    values: [used, over, left],
    colors: [C_FACT, C_BAD, C_REST],
  };
}

/** Диапазон блока сырья в строке `r`: например «$J5:$U5». */
function rawRange(start: number, r: number): string {
  return `$${columnLetter(start)}${r}:$${columnLetter(start + 11)}${r}`;
}

/**
 * Формулы одной строки листа данных.
 *
 * Знак отклонения зеркальный у доходов (см. `yearDiff`): у расхода «хорошо» —
 * это остаток плана, у дохода — перевыполнение.
 */
function rowFormulas(r: number, kind: "expense" | "income"): Map<string, string> {
  const at = (col: number) => `$${columnLetter(col)}${r}`;
  const fact = rawRange(D.rawFact, r);
  const plan = rawRange(D.rawPlan, r);
  const prev = rawRange(D.rawPrev, r);
  const diff = (planCell: string, factCell: string) =>
    kind === "income" ? `${factCell}-${planCell}` : `${planCell}-${factCell}`;
  return new Map([
    [cellRef(D.factMonth, r), `INDEX(${fact},${MONTH_CELL})`],
    [cellRef(D.planMonth, r), `INDEX(${plan},${MONTH_CELL})`],
    [cellRef(D.varMonth, r), diff(at(D.planMonth), at(D.factMonth))],
    [
      cellRef(D.growthMonth, r),
      `IFERROR((${at(D.factMonth)}-${at(D.prevMonthFact)})/${at(D.prevMonthFact)},"")`,
    ],
    [
      cellRef(D.factYtd, r),
      `SUM($${columnLetter(D.rawFact)}${r}:INDEX(${fact},${MONTH_CELL}))`,
    ],
    [
      cellRef(D.planYtd, r),
      `SUM($${columnLetter(D.rawPlan)}${r}:INDEX(${plan},${MONTH_CELL}))`,
    ],
    [cellRef(D.varYtd, r), diff(at(D.planYtd), at(D.factYtd))],
    [
      cellRef(D.growthYtd, r),
      `IFERROR((${at(D.factYtd)}-${at(D.prevYtdFact)})/${at(D.prevYtdFact)},"")`,
    ],
    // Январь берёт декабрь ПРОШЛОГО года — иначе рост «месяц к месяцу» в
    // январе всегда пустой, хотя сравнить есть с чем.
    [
      cellRef(D.prevMonthFact, r),
      `IF(${MONTH_CELL}=1,$${columnLetter(D.rawPrev + 11)}${r},INDEX(${fact},${MONTH_CELL}-1))`,
    ],
    [
      cellRef(D.prevYtdFact, r),
      `SUM($${columnLetter(D.rawPrev)}${r}:INDEX(${prev},${MONTH_CELL}))`,
    ],
    [cellRef(D.prevMonthYear, r), `INDEX(${prev},${MONTH_CELL})`],
  ]);
}

export function buildDataSheet(d: BudgetDashboard, format: string): DataSheet {
  const m = d.monthIndex;
  const head = (v: string): XlsxCell =>
    text(v, { fontWeight: "bold", backgroundColor: BG_HEAD, wrap: true, alignVertical: "bottom" });
  const rawHead = (prefix: string): XlsxCell[] =>
    MONTH_SHORT.map((s) => head(`${prefix} ${s}`));

  const rows: Row[] = [
    [
      head("Статья"),
      head("Факт, месяц"),
      head("План, месяц"),
      head("Отклонение, месяц"),
      head("Рост к прошлому месяцу"),
      head("Факт с начала года"),
      head("План с начала года"),
      head("Отклонение с начала года"),
      head("Рост к прошлому году"),
      ...rawHead("Факт"),
      ...rawHead("План"),
      ...rawHead(`Факт ${d.year - 1}`),
      head("Факт прошлого месяца"),
      head(`С начала года, ${d.year - 1}`),
      head(`Месяц ${d.year - 1}`),
    ],
  ];
  const formulas = new Map<string, string>();

  /** Дописать строку: подпись, посчитанные значения (кэш) и сырьё. */
  const push = (
    label: string,
    kind: "expense" | "income",
    factByMonth: number[],
    planByMonth: number[],
    prevFactByMonth: number[],
    style: Partial<XlsxCell>
  ): DataRowRef => {
    const r = rows.length + 1;
    const factMonth = atMonth(factByMonth, m);
    const planMonth = atMonth(planByMonth, m);
    const factYtd = ytd(factByMonth, m);
    const planYtd = ytd(planByMonth, m);
    const prevM = prevMonth(factByMonth, prevFactByMonth, m);
    const prevY = ytd(prevFactByMonth, m);
    rows.push([
      text(label, style),
      // Значения — кэш для программ, которые формул не считают; при открытии в
      // Excel их пересчитает формула из `formulas`.
      num(factMonth, format),
      num(planMonth, format),
      num(variance(factMonth, planMonth, kind), format),
      num(growth(factMonth, prevM), PCT_FORMAT),
      num(factYtd, format),
      num(planYtd, format),
      num(variance(factYtd, planYtd, kind), format),
      num(growth(factYtd, prevY), PCT_FORMAT),
      ...factByMonth.map((v) => num(v, format)),
      ...planByMonth.map((v) => num(v, format)),
      ...prevFactByMonth.map((v) => num(v, format)),
      num(prevM, format),
      num(prevY, format),
      num(atMonth(prevFactByMonth, m), format),
    ]);
    for (const [addr, f] of rowFormulas(r, kind)) formulas.set(addr, f);
    return { row: r, kind };
  };

  for (const r of d.rows) {
    push(
      // Подпись, а не голое имя категории: под-категория без родителя («Кафе»)
      // на оси диаграммы не отвечает на вопрос «чьё».
      r.label,
      "expense",
      r.factByMonth,
      r.planByMonth,
      r.prevFactByMonth,
      r.subcategory ? { textColor: TEXT_SUB, indent: 1 } : { fontWeight: "bold" }
    );
  }

  // ── Итоги: на них ссылаются показатели «Дашборда» ──
  rows.push([]);
  rows.push([text("Итоги", { fontWeight: "bold", backgroundColor: BG_HEAD })]);
  const e = d.expense;
  const i = d.income;
  const bold = { fontWeight: "bold" as const };

  const expense = push("Расходы", "expense", e.factByMonth, e.planByMonth, e.prevFactByMonth, bold);
  const expenseAll = e.hasTransfers
    ? push(
        "Расходы, включая переводы",
        "expense",
        e.factAllByMonth,
        e.planByMonth,
        e.prevFactAllByMonth,
        { textColor: TEXT_SUB }
      )
    : null;
  const income = push("Доходы", "income", i.factByMonth, i.planByMonth, i.prevFactByMonth, bold);
  const incomeAll = i.hasTransfers
    ? push(
        "Доходы, включая переводы",
        "income",
        i.factAllByMonth,
        i.planByMonth,
        i.prevFactAllByMonth,
        { textColor: TEXT_SUB }
      )
    : null;
  // Разница считается по ПОЛНЫМ итогам: перевод внутри бюджета даёт обе ноги и
  // гасится сам, перевод наружу оставляет одну — настоящий отток.
  const minus = (a: number[], b: number[]) => a.map((v, k) => v - (b[k] ?? 0));
  const delta = push(
    "Разница",
    "income",
    minus(i.factAllByMonth, e.factAllByMonth),
    minus(i.planByMonth, e.planByMonth),
    minus(i.prevFactAllByMonth, e.prevFactAllByMonth),
    bold
  );

  // ── Доли бубликов: тоже формулы, иначе они не поедут за месяцем ──
  const donut = (title: string, ref: DataRowRef, factCol: number, planCol: number): DonutBlock => {
    rows.push([]);
    rows.push([text(title, { fontWeight: "bold", backgroundColor: BG_HEAD })]);
    const factCell = `$${columnLetter(factCol)}${ref.row}`;
    const planCell = `$${columnLetter(planCol)}${ref.row}`;
    const slices = planSlices(
      (rows[ref.row - 1][factCol] as XlsxCell).value as number,
      (rows[ref.row - 1][planCol] as XlsxCell).value as number
    );
    const firstRow = rows.length + 1;
    const parts = [
      `MAX(0,MIN(${factCell},${planCell}))`,
      `MAX(0,${factCell}-${planCell})`,
      `MAX(0,${planCell}-${factCell})`,
    ];
    slices.labels.forEach((label, k) => {
      rows.push([text(label), num(slices.values[k], format)]);
      formulas.set(cellRef(1, rows.length), parts[k]);
    });
    return { firstRow, ...slices };
  };

  const donutMonth = donut("Выполнение плана — месяц", expense, D.factMonth, D.planMonth);
  const donutYtd = donut("Выполнение плана — с начала года", expense, D.factYtd, D.planYtd);

  return {
    rows,
    formulas,
    totals: { expense, expenseAll, income, incomeAll, delta },
    donutMonth,
    donutYtd,
  };
}

/** Ширины колонок листа данных: сырьё узкое, оно для формул, а не для чтения. */
function dataColumns() {
  return [
    { width: 30 },
    ...Array.from({ length: 8 }, () => ({ width: 16 })),
    ...Array.from({ length: 36 }, () => ({ width: 10 })),
    ...Array.from({ length: 3 }, () => ({ width: 14 })),
  ];
}

// ── Диаграммы ────────────────────────────────────────────────────────────────

/** Цвета точек по знаку: «хорошо» зелёным, «плохо» красным. */
function signColors(values: (number | null)[]): (string | null)[] {
  return values.map((v) => (v === null || !Number.isFinite(v) ? null : v >= 0 ? C_GOOD : C_BAD));
}

// ── Сетка дашборда ───────────────────────────────────────────────────────────
//
// Все колонки листа одной ширины, а подпись показателя в шапке растянута на
// две. Иначе первая колонка была бы широкой «под названия», и диаграммы,
// начинаясь со второй, стояли бы с пустым полем во всю её ширину.

/** Ширина колонки листа «Дашборд» в знаках. */
const DASH_COL_W = 14;
/** Сколько колонок занимает подпись показателя в шапке. */
const KPI_LABEL_COLS = 3;
/** Сколько колонок занимает одна полосовая диаграмма (их четыре в ряд). */
const CHART_COLS = 4;
const CHARTS_PER_ROW = 4;
/**
 * Первая строка (0-инд.) под диаграммами.
 *
 * Считается от фактической высоты таблицы показателей: строк «включая
 * переводы» может не быть, и фиксированное число либо оставляло дыру, либо
 * клало первый бублик поверх примечания.
 */
function chartsTop(dashboardRows: number): number {
  return dashboardRows + 1;
}
/** Высота ряда бубликов в строках листа. */
const DONUT_H = 16;

/**
 * Высота полосовой диаграммы в строках листа.
 *
 * Растёт вместе с числом статей: на дашборде все категории и их под-категории,
 * а у фиксированной высоты сорок полос превращаются в неразличимую гребёнку.
 * Плюс запас на заголовок и поля.
 */
export function barChartHeight(rowCount: number): number {
  return Math.max(16, rowCount + 6);
}

export function buildCharts(
  d: BudgetDashboard,
  data: DataSheet,
  format: string,
  dashboardRows: number
): ChartSpec[] {
  const labels = d.rows.map((r) => r.label);
  const m = d.monthIndex;
  const H = barChartHeight(d.rows.length);
  /** Привязка i-й диаграммы в ряду, начинающемся со строки `top`. */
  const cell = (i: number, top: number, height: number) => ({
    col: i * CHART_COLS,
    row: top,
    toCol: (i + 1) * CHART_COLS,
    toRow: top + height,
  });
  const top = chartsTop(dashboardRows);
  const monthTop = top + DONUT_H + 1;
  const ytdTop = monthTop + H + 1;
  const base = {
    sheet: SHEET_DATA,
    categories: { labels, column: D.label, firstRow: DATA_FIRST_ROW },
    dataLabels: true,
    numberFormat: format,
  } as const;

  const bar = (
    title: string,
    column: number,
    values: (number | null)[],
    color: string,
    anchor: ChartSpec["anchor"],
    opts: Partial<ChartSpec> = {}
  ): ChartSpec => {
    const nums = values.map((v) => (v === null ? NaN : v));
    return {
      ...base,
      kind: "bar",
      title,
      series: [{ name: title, column, values: nums, color }],
      anchor,
      ...opts,
    };
  };

  /** Полоса «хорошо/плохо» по знаку: отклонение и рост красятся по точкам. */
  const signed = (
    title: string,
    column: number,
    values: (number | null)[],
    anchor: ChartSpec["anchor"],
    /** У расхода рост — это «хуже», поэтому знак для цвета переворачивается. */
    invert: boolean,
    percent: boolean
  ): ChartSpec => ({
    ...bar(title, column, values, C_GOOD, anchor),
    ...(percent ? { numberFormat: PCT_FORMAT } : {}),
    series: [
      {
        name: title,
        column,
        values: values.map((v) => (v === null ? NaN : v)),
        color: C_GOOD,
        pointColors: signColors(values.map((v) => (v === null ? null : invert ? -v : v))),
      },
    ],
  });

  const donut = (title: string, block: DonutBlock, anchor: ChartSpec["anchor"]): ChartSpec => ({
    kind: "doughnut",
    // Без подписей долей: «перерасход» бывает узкой полоской, и его подпись
    // налезала на соседнюю. Числа и процент видны в таблице показателей.
    title,
    sheet: SHEET_DATA,
    categories: { labels: block.labels, column: 0, firstRow: block.firstRow },
    series: [{ name: title, column: 1, values: block.values, pointColors: block.colors }],
    anchor,
    legend: true,
    numberFormat: format,
  });

  const factMonth = d.rows.map((r) => atMonth(r.factByMonth, m));
  const planMonth = d.rows.map((r) => atMonth(r.planByMonth, m));
  const factYtd = d.rows.map((r) => ytd(r.factByMonth, m));
  const planYtd = d.rows.map((r) => ytd(r.planByMonth, m));
  const varMonth = factMonth.map((f, k) => variance(f, planMonth[k], "expense"));
  const varYtd = factYtd.map((f, k) => variance(f, planYtd[k], "expense"));
  const growthMonth = d.rows.map((r, k) =>
    growth(factMonth[k], prevMonth(r.factByMonth, r.prevFactByMonth, m))
  );
  const growthYtd = d.rows.map((r, k) => growth(factYtd[k], ytd(r.prevFactByMonth, m)));

  // Сетка привязки: два бублика в ряд, затем два ряда по четыре полосовых.
  // Всё считается от нулевой колонки — иначе слева остаётся пустое поле во всю
  // ширину первой колонки.
  return [
    donut("Выполнение плана — месяц", data.donutMonth, {
      col: 0,
      row: top,
      toCol: 8,
      toRow: top + DONUT_H,
    }),
    donut("Выполнение плана — с начала года", data.donutYtd, {
      col: 8,
      row: top,
      toCol: 16,
      toRow: top + DONUT_H,
    }),

    bar("Факт — месяц", D.factMonth, factMonth, C_FACT, cell(0, monthTop, H)),
    bar("План — месяц", D.planMonth, planMonth, C_PLAN, cell(1, monthTop, H)),
    signed("Отклонение от плана — месяц", D.varMonth, varMonth, cell(2, monthTop, H), false, false),
    signed("Рост к прошлому месяцу", D.growthMonth, growthMonth, cell(3, monthTop, H), true, true),

    bar("Факт — с начала года", D.factYtd, factYtd, C_FACT, cell(0, ytdTop, H)),
    bar("План — с начала года", D.planYtd, planYtd, C_PLAN, cell(1, ytdTop, H)),
    signed(
      "Отклонение от плана — с начала года",
      D.varYtd,
      varYtd,
      cell(2, ytdTop, H),
      false,
      false
    ),
    signed("Рост к прошлому году", D.growthYtd, growthYtd, cell(3, ytdTop, H), true, true),
  ];
}

// ── Лист «Дашборд» ───────────────────────────────────────────────────────────

interface DashboardSheet {
  rows: Row[];
  formulas: Map<string, string>;
  /** Ячейка с выпадающим списком месяцев. */
  monthCell: string;
  monthOptions: string[];
}

export function buildDashboardSheet(
  d: BudgetDashboard,
  data: DataSheet,
  format: string
): DashboardSheet {
  const m = d.monthIndex;
  const head = (v: string): XlsxCell =>
    text(v, { fontWeight: "bold", backgroundColor: BG_HEAD, wrap: true, align: "center" });
  const formulas = new Map<string, string>();
  const rows: Row[] = [];
  /** Ссылка на ячейку листа данных. */
  const src = (col: number, row: number) => `'${SHEET_DATA}'!$${columnLetter(col)}$${row}`;

  const value = (v: number | null, fmt: string, extra: Partial<XlsxCell> = {}) =>
    num(v, fmt, extra);

  /**
   * Строка показателя — целиком из ссылок на лист данных. Своих вычислений на
   * «Дашборде» нет: одно место правды, и при смене месяца всё едет вместе.
   */
  const kpi = (
    label: string,
    bg: string,
    ref: DataRowRef,
    period: "month" | "ytd",
    /**
     * `full` — статья с планом. `turnover` — оборот со счетами: плана у
     * переводов нет, и «выполнение плана 104%» у него значило бы, что оборот
     * сравнили с планом трат. `net` — разница: план есть, а «выполнение» и
     * «отклонение» у неё бессмысленны (делить дефицит на профицит нечего).
     */
    mode: "full" | "turnover" | "net" = "full",
    style: Partial<XlsxCell> = {}
  ): Row => {
    const r = rows.length + 1;
    const cols =
      period === "month"
        ? { fact: D.factMonth, plan: D.planMonth, vari: D.varMonth, grow: D.growthMonth, prev: D.prevMonthYear }
        : { fact: D.factYtd, plan: D.planYtd, vari: D.varYtd, grow: D.growthYtd, prev: D.prevYtdFact };
    const cell = (col: number) => cellRef(col + KPI_LABEL_COLS, r);
    const withPlan = mode !== "turnover";
    const withRatio = mode === "full";
    formulas.set(cell(0), src(cols.fact, ref.row));
    if (withPlan) formulas.set(cell(1), src(cols.plan, ref.row));
    formulas.set(cell(2), src(cols.prev, ref.row));
    if (withRatio) {
      formulas.set(cell(3), src(cols.vari, ref.row));
      formulas.set(cell(4), `IFERROR(${src(cols.fact, ref.row)}/${src(cols.plan, ref.row)},"")`);
    }
    formulas.set(cell(5), src(cols.grow, ref.row));
    // Значения — кэш; настоящие числа посчитает Excel по формулам выше.
    const cached = (col: number): number | null => {
      const v = (data.rows[ref.row - 1][col] as XlsxCell | undefined)?.value;
      return typeof v === "number" ? v : null;
    };
    const fact = cached(cols.fact);
    const plan = withPlan ? cached(cols.plan) : null;
    return [
      // Подпись на три колонки: колонки листа одной ширины ради ровной сетки
      // диаграмм, а в одну «Расход, включая переводы — с начала года» не лезет
      // и половиной уходит под соседнее значение.
      text(label, { fontWeight: "bold", backgroundColor: bg, ...style, columnSpan: KPI_LABEL_COLS }),
      null,
      null,
      value(fact, format, { backgroundColor: bg }),
      value(plan, format, { backgroundColor: bg }),
      value(cached(cols.prev), format, { backgroundColor: bg }),
      value(withRatio ? cached(cols.vari) : null, format, { backgroundColor: bg }),
      value(
        withRatio && fact !== null && plan !== null ? achievement(fact, plan) : null,
        PCT_FORMAT,
        { backgroundColor: bg }
      ),
      value(cached(cols.grow), PCT_FORMAT, { backgroundColor: bg }),
    ];
  };

  rows.push([
    text(`Бюджет ${d.year} — годовой отчёт`, { fontWeight: "bold", fontSize: 16 }),
    ...Array.from({ length: 13 }, () => null),
    text("Месяц", { fontWeight: "bold", align: "right" }),
    text(MONTH_NAMES[m], {
      fontWeight: "bold",
      align: "center",
      backgroundColor: BG_HEAD,
    }),
  ]);
  rows.push([
    text(
      "Показатели «за месяц» считаются по выбранному месяцу, «с начала года» — с января по него включительно.",
      { textColor: TEXT_MUTED }
    ),
    ...Array.from({ length: 13 }, () => null),
    text("№ месяца", { textColor: TEXT_MUTED, align: "right" }),
    num(m + 1, "0", { textColor: TEXT_MUTED }),
  ]);
  // Номер считает сам Excel — иначе выпадашка меняла бы только подпись.
  formulas.set(
    cellRef(15, 2),
    `MATCH($P$1,{${MONTH_NAMES.map((n) => `"${n}"`).join(";")}},0)`
  );

  rows.push([]);
  rows.push([
    { ...head("Показатель"), columnSpan: KPI_LABEL_COLS, align: "left" as const },
    null,
    null,
    head("Факт"),
    head("План"),
    head("Прошлый год"),
    head("Отклонение от плана"),
    head("Выполнение плана"),
    head("Рост к прошлому году"),
  ]);

  const t = data.totals;
  rows.push(kpi("Расходы — месяц", BG_EXPENSE, t.expense, "month"));
  rows.push(kpi("Расходы — с начала года", BG_EXPENSE, t.expense, "ytd"));
  // Оборот по счетам — отдельными строками и только когда переводы есть.
  // Подменять ими расход нельзя: перекладывание денег между своими счетами
  // тратой не является.
  if (t.expenseAll) {
    rows.push(
      kpi("Расход, включая переводы — месяц", BG_EXPENSE, t.expenseAll, "month", "turnover", {
        textColor: TEXT_SUB,
      })
    );
    rows.push(
      kpi("Расход, включая переводы — с начала года", BG_EXPENSE, t.expenseAll, "ytd", "turnover", {
        textColor: TEXT_SUB,
      })
    );
  }
  rows.push(kpi("Доходы — месяц", BG_INCOME, t.income, "month"));
  rows.push(kpi("Доходы — с начала года", BG_INCOME, t.income, "ytd"));
  if (t.incomeAll) {
    rows.push(
      kpi("Доход, включая переводы — месяц", BG_INCOME, t.incomeAll, "month", "turnover", {
        textColor: TEXT_SUB,
      })
    );
    rows.push(
      kpi("Доход, включая переводы — с начала года", BG_INCOME, t.incomeAll, "ytd", "turnover", {
        textColor: TEXT_SUB,
      })
    );
  }
  rows.push(kpi("Разница — месяц", BG_NEUTRAL, t.delta, "month", "net"));
  rows.push(kpi("Разница — с начала года", BG_NEUTRAL, t.delta, "ytd", "net"));

  rows.push([]);
  rows.push([
    text(
      `На диаграммах — все статьи расходов с под-категориями (${d.rows.length} строк). Смените месяц в ячейке справа сверху — показатели и диаграммы пересчитаются.`,
      { textColor: TEXT_MUTED }
    ),
  ]);

  return { rows, formulas, monthCell: "P1", monthOptions: MONTH_NAMES };
}

/**
 * Ширины колонок «Дашборда».
 *
 * ВСЕ одинаковые: диаграммы привязаны к клеткам, и широкая первая колонка
 * «под названия» превратилась бы в пустое поле слева от каждой из них. Место
 * под названия показателей даёт `columnSpan` в самих строках.
 */
function dashboardColumns() {
  return Array.from({ length: CHART_COLS * CHARTS_PER_ROW }, () => ({ width: DASH_COL_W }));
}

// ── Лист «По месяцам» ────────────────────────────────────────────────────────

interface MonthsSheet {
  rows: Row[];
  /** Номера строк подкатегорий — их убираем под плюсики. */
  outlineRows: number[];
}

export function buildMonthsSheet(report: BudgetYearReport, format: string): MonthsSheet {
  const rows: Row[] = [];
  const outlineRows: number[] = [];

  const head = (v: string, extra: Partial<XlsxCell> = {}): XlsxCell =>
    text(v, { fontWeight: "bold", backgroundColor: BG_HEAD, align: "center", ...extra });

  // Две строки шапки: месяц над тройкой «План · Факт · Разница».
  const monthHead: Row = [head("")];
  const subHead: Row = [head("Статья", { align: "left" })];
  for (const ym of report.months) {
    monthHead.push(
      head(monthLabelFull(ym).replace(/\s\d+ г\.$/, ""), {
        columnSpan: 3,
        leftBorderStyle: "thin",
        leftBorderColor: BORDER,
      })
    );
    monthHead.push(null, null);
    subHead.push(head("План", { leftBorderStyle: "thin", leftBorderColor: BORDER }));
    subHead.push(head("Факт"));
    subHead.push(head("Разница"));
  }
  monthHead.push(head("За год", { columnSpan: 3, leftBorderStyle: "thin", leftBorderColor: BORDER }));
  monthHead.push(null, null);
  subHead.push(head("План", { leftBorderStyle: "thin", leftBorderColor: BORDER }));
  subHead.push(head("Факт"));
  subHead.push(head("Разница"));
  rows.push(monthHead, subHead);

  const dataRow = (label: string, row: YearRow, style: Partial<XlsxCell>, indent = 0): Row => {
    const out: Row = [text(label, { indent, ...style })];
    for (const cell of row.cells) {
      out.push(num(cell.plan, format, { ...style, leftBorderStyle: "thin", leftBorderColor: BORDER }));
      out.push(num(cell.fact, format, style));
      out.push(num(yearDiff(cell, row.kind), format, style));
    }
    out.push(
      num(row.plan, format, {
        ...style,
        fontWeight: "bold",
        leftBorderStyle: "thin",
        leftBorderColor: BORDER,
      })
    );
    out.push(num(row.fact, format, { ...style, fontWeight: "bold" }));
    out.push(
      num(yearDiff({ plan: row.plan, fact: row.fact }, row.kind), format, {
        ...style,
        fontWeight: "bold",
      })
    );
    return out;
  };

  const totalsRow = (
    label: string,
    section: YearSection,
    cells: YearCell[],
    plan: number,
    fact: number,
    style: Partial<XlsxCell>
  ): Row =>
    dataRow(
      label,
      {
        key: label,
        kind: section.kind,
        category: label,
        subcategory: null,
        cells,
        plan,
        fact,
      },
      style
    );

  const section = (title: string, s: YearSection, bg: string): void => {
    rows.push([text(title, { fontWeight: "bold", backgroundColor: bg })]);
    for (const g of s.groups) {
      rows.push(dataRow(g.category, g.total, { fontWeight: "bold" }));
      for (const sub of g.subs) {
        outlineRows.push(rows.length + 1);
        rows.push(dataRow(sub.subcategory ?? g.category, sub, { textColor: TEXT_SUB }, 1));
      }
    }
    rows.push(
      totalsRow(`Итого ${title.toLowerCase()}`, s, s.totals, s.plan, s.fact, {
        fontWeight: "bold",
        backgroundColor: bg,
      })
    );
    // Вторая строка итога — только когда переводы есть. Она про другой вопрос:
    // не «сколько потрачено», а «сколько прошло по счетам».
    if (hasTransfers(s)) {
      rows.push(
        totalsRow(
          `${s.kind === "expense" ? "Расход" : "Доход"}, включая переводы`,
          s,
          s.totalsAll,
          s.planAll,
          s.factAll,
          { fontWeight: "bold", backgroundColor: bg, textColor: TEXT_SUB }
        )
      );
    }
    rows.push([]);
  };

  section("Расходы", report.expense, BG_EXPENSE);
  section("Доходы", report.income, BG_INCOME);

  // «Разница» — доходы минус расходы; знак у неё прямой, без зеркала `yearDiff`.
  const delta: Row = [
    text("Разница", { fontWeight: "bold", backgroundColor: BG_NEUTRAL }),
  ];
  let planYear = 0;
  let factYear = 0;
  for (const c of report.delta) {
    planYear += c.plan;
    factYear += c.fact;
    delta.push(
      num(c.plan, format, {
        fontWeight: "bold",
        backgroundColor: BG_NEUTRAL,
        leftBorderStyle: "thin",
        leftBorderColor: BORDER,
      })
    );
    delta.push(num(c.fact, format, { fontWeight: "bold", backgroundColor: BG_NEUTRAL }));
    delta.push(num(c.fact - c.plan, format, { fontWeight: "bold", backgroundColor: BG_NEUTRAL }));
  }
  delta.push(
    num(planYear, format, {
      fontWeight: "bold",
      backgroundColor: BG_NEUTRAL,
      leftBorderStyle: "thin",
      leftBorderColor: BORDER,
    })
  );
  delta.push(num(factYear, format, { fontWeight: "bold", backgroundColor: BG_NEUTRAL }));
  delta.push(num(factYear - planYear, format, { fontWeight: "bold", backgroundColor: BG_NEUTRAL }));
  rows.push(delta);

  return { rows, outlineRows };
}

// ── Лист «Год к году» ────────────────────────────────────────────────────────

export function buildYoySheet(
  d: BudgetDashboard,
  report: BudgetYearReport,
  prev: BudgetYearReport,
  format: string
): Row[] {
  const m = d.monthIndex;
  const monthName = monthLabelFull(d.month).replace(/\s\d+ г\.$/, "").toLowerCase();
  const period = `январь — ${monthName}`;

  const head = (v: string): XlsxCell =>
    text(v, { fontWeight: "bold", backgroundColor: BG_HEAD, wrap: true, align: "center" });

  const rows: Row[] = [
    [text(`Сравнение с прошлым годом · ${period}`, { fontWeight: "bold", fontSize: 14 })],
    [],
    [
      head("Статья"),
      head(`Факт ${report.year}`),
      head(`Факт ${prev.year}`),
      head("Изменение"),
      head("Рост"),
      head(`План ${report.year}`),
      head("Отклонение от плана"),
    ],
  ];

  const sumTo = (cells: { plan: number; fact: number }[]) => {
    let plan = 0;
    let fact = 0;
    for (let i = 0; i <= m; i++) {
      plan += cells[i]?.plan ?? 0;
      fact += cells[i]?.fact ?? 0;
    }
    return { plan, fact };
  };

  const block = (title: string, s: YearSection, p: YearSection, bg: string): void => {
    rows.push([text(title, { fontWeight: "bold", backgroundColor: bg })]);
    const prevByCat = new Map(p.groups.map((g) => [g.category, g.total.cells] as const));
    const items = s.groups
      .map((g) => {
        const cur = sumTo(g.total.cells);
        const before = prevByCat.get(g.category);
        return {
          category: g.category,
          fact: cur.fact,
          plan: cur.plan,
          prev: before ? sumTo(before).fact : 0,
        };
      })
      .filter((r) => r.fact !== 0 || r.plan !== 0 || r.prev !== 0)
      .sort(
        (a, b) =>
          Number(b.category === TRANSFER_CATEGORY) -
            Number(a.category === TRANSFER_CATEGORY) || b.fact - a.fact
      );

    for (const r of items) {
      rows.push([
        text(r.category),
        num(r.fact, format),
        num(r.prev, format),
        num(r.fact - r.prev, format),
        num(growth(r.fact, r.prev), PCT_FORMAT),
        num(r.plan, format),
        num(variance(r.fact, r.plan, s.kind), format),
      ]);
    }

    const cur = sumTo(s.totals);
    const before = sumTo(p.totals);
    rows.push([
      text(`Итого ${title.toLowerCase()}`, { fontWeight: "bold", backgroundColor: bg }),
      num(cur.fact, format, { fontWeight: "bold", backgroundColor: bg }),
      num(before.fact, format, { fontWeight: "bold", backgroundColor: bg }),
      num(cur.fact - before.fact, format, { fontWeight: "bold", backgroundColor: bg }),
      num(growth(cur.fact, before.fact), PCT_FORMAT, { fontWeight: "bold", backgroundColor: bg }),
      num(cur.plan, format, { fontWeight: "bold", backgroundColor: bg }),
      num(variance(cur.fact, cur.plan, s.kind), format, {
        fontWeight: "bold",
        backgroundColor: bg,
      }),
    ]);
    rows.push([]);
  };

  block("Расходы", report.expense, prev.expense, BG_EXPENSE);
  block("Доходы", report.income, prev.income, BG_INCOME);

  return rows;
}

// ── Сборка книги ─────────────────────────────────────────────────────────────

export function buildWorkbook(
  report: BudgetYearReport,
  prev: BudgetYearReport,
  monthIndex: number,
  baseCurrency: string,
  style: XlsxNumberStyle = "money"
) {
  const format = budgetFormat(baseCurrency, style);
  const dashboard = buildBudgetDashboard(report, prev, monthIndex);
  const data = buildDataSheet(dashboard, format);
  const dash = buildDashboardSheet(dashboard, data, format);
  const months = buildMonthsSheet(report, format);

  const sheets = [
    {
      data: dash.rows,
      sheet: SHEET_DASH,
      columns: dashboardColumns(),
      showGridLines: false,
    },
    {
      data: months.rows,
      sheet: SHEET_MONTHS,
      columns: [{ width: 34 }, ...Array.from({ length: 39 }, () => ({ width: 13 }))],
      stickyRowsCount: 2,
      stickyColumnsCount: 1,
    },
    {
      data: buildYoySheet(dashboard, report, prev, format),
      sheet: SHEET_YOY,
      columns: [{ width: 34 }, ...Array.from({ length: 6 }, () => ({ width: 18 }))],
      stickyRowsCount: 3,
      stickyColumnsCount: 1,
    },
    {
      data: data.rows,
      sheet: SHEET_DATA,
      columns: dataColumns(),
      stickyRowsCount: 1,
      stickyColumnsCount: 1,
    },
  ];

  return {
    sheets,
    charts: buildCharts(dashboard, data, format, dash.rows.length),
    outlineRows: months.outlineRows,
    dashboard,
    dash,
    data,
  };
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Записать годовой отчёт и отдать файл пользователю.
 *
 * `monthIndex` — месяц, по которому считаются показатели «за месяц» и отрезок
 * «с начала года»; на странице это выбранный месяц.
 */
export async function exportBudgetYearXlsx(
  report: BudgetYearReport,
  prev: BudgetYearReport,
  monthIndex: number,
  baseCurrency: string,
  fileName: string,
  style: XlsxNumberStyle = "money"
): Promise<void> {
  const { sheets, charts, outlineRows, dash, data } = buildWorkbook(
    report,
    prev,
    monthIndex,
    baseCurrency,
    style
  );
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const blob = await writeXlsxFile(sheets as never).toBlob();
  const withCharts = await injectCharts(blob, SHEET_DASH, charts, (files) =>
    patchSheets(files, { dash, data, outlineRows })
  );
  downloadBlob(withCharts, fileName);
}

/**
 * Всё, чего писатель не умеет: формулы, выпадающий список месяца, группировка
 * строк и пересчёт при открытии.
 *
 * Вынесено отдельной функцией, чтобы тест собирал файл ровно тем же путём, что
 * и кнопка, — иначе проверка ничего не гарантирует.
 */
export function patchSheets(
  files: Record<string, string>,
  parts: {
    dash: { formulas: Map<string, string>; monthCell: string; monthOptions: string[] };
    data: { formulas: Map<string, string> };
    outlineRows: number[];
  }
): Record<string, string> {
  // Путь ищем по имени листа, а не «sheet2.xml»: порядок файлов внутри архива
  // библиотеке никто не диктует, а правка не на том листе выглядит как
  // работающая функция.
  const dashPath = sheetPathByName(files, SHEET_DASH);
  const dataPath = sheetPathByName(files, SHEET_DATA);
  const monthsPath = sheetPathByName(files, SHEET_MONTHS);

  const out: Record<string, string> = {
    [dashPath]: addListValidation(
      setFormulas(files[dashPath], parts.dash.formulas),
      parts.dash.monthCell,
      parts.dash.monthOptions
    ),
    [dataPath]: setFormulas(files[dataPath], parts.data.formulas),
    // Наши формулы приходят с кэшем от генератора, а не от Excel; без этого
    // флага он верит кэшу и показывает старые числа до первой правки.
    "xl/workbook.xml": forceRecalc(files["xl/workbook.xml"]),
  };
  // Подкатегории — под плюсики. Тот же приём, что в отчёте «Доходы и расходы».
  if (parts.outlineRows.length > 0)
    out[monthsPath] = addRowOutline(files[monthsPath], parts.outlineRows);
  return out;
}
