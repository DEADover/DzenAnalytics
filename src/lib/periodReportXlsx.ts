/**
 * «Отчёт за период» в Excel — третий формат рядом с PDF и HTML.
 *
 * Те же разделы, что на листах отчёта, только таблицами: каждый раздел —
 * свой лист, суммы — числами с денежным форматом, доли — процентами, даты —
 * датами. По ним в Excel сразу считаются формулы, сортируется и строятся свои
 * диаграммы. Числа и слова берутся из той же модели отчёта
 * (`usePeriodReport`), что и PDF, — расходиться им не с чего.
 *
 * Модуль подгружается только по кнопке «Скачать» вместе с пакетом
 * write-excel-file: в стартовом бандле он не нужен.
 */

import type { PeriodReport } from "../hooks/usePeriodReport";
import type { XlsxCell as BaseCell } from "./budgetYearXlsx";
import { moneyFormat } from "./categoryReportXlsx";
import { downloadBlob } from "./downloadBlob";
import { formatDate, monthTitle, stripAmountMarks } from "./format";
import { describeObservation } from "./observationTile";
import { spanDays } from "./period";
import { reportCompareNote, reportDatesNote, reportHeadline } from "./periodReportText";
import { pluralRu } from "./plural";

/** Ячейка листа: та же форма, что у остальных выгрузок, плюс даты. */
export type Cell = Omit<BaseCell, "type" | "value"> & {
  value?: string | number | Date | null;
  type?: StringConstructor | NumberConstructor | DateConstructor;
};
export type Row = (Cell | null)[];

export interface Sheet {
  sheet: string;
  data: Row[];
  columns: { width: number }[];
  stickyRowsCount?: number;
}

// Шапки таблиц и итоговые строки — нейтральные, как в других выгрузках;
// доходы и расходы окрашены по смыслу бледными тонами, чтобы не забивать суммы.
const HEADER_BG = "#F3F4F6";
const TOTAL_BG = "#F3F4F6";
const INCOME_TEXT = "#15803D";
const EXPENSE_TEXT = "#B91C1C";
const MUTED_TEXT = "#6B7280";
const PERCENT = "0.0%";
/** Изменение — со знаком: «+24,7 %», «−3,0 %». */
const CHANGE = "+0.0%;-0.0%;0.0%";
const INTEGER = "0";
const DATE = "dd.mm.yyyy";

const text = (value: string, opts: Partial<Cell> = {}): Cell => ({ value: stripAmountMarks(value), type: String, ...opts });
const head = (value: string, right = false): Cell => ({
  value,
  type: String,
  fontWeight: "bold",
  backgroundColor: HEADER_BG,
  ...(right ? { align: "right" as const } : {}),
});
/** Дата «YYYY-MM-DD» — полночью по UTC: так Excel покажет ровно этот день. */
const date = (iso: string, opts: Partial<Cell> = {}): Cell => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return { value: new Date(Date.UTC(y, m - 1, d)), type: Date, format: DATE, align: "left", ...opts };
};
const title = (value: string): Row => [text(value, { fontWeight: "bold", fontSize: 14 })];
const note = (value: string): Row => [text(value, { textColor: MUTED_TEXT })];
/** Пустая строка-разделитель: совсем без ячеек писатель её выбрасывает. */
const blank: Row = [null];

/** Число или пустая ячейка, если значения нет. */
function num(value: number | null | undefined, format: string, opts: Partial<Cell> = {}): Cell | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return { value, type: Number, format, align: "right", ...opts };
}

/** Изменение к прошлому: «−0,12» → −12 %. Нечего сравнивать — пусто. */
function change(now: number, prev: number | null | undefined): number | null {
  if (prev === null || prev === undefined || Math.abs(prev) < 0.005) return null;
  return now / prev - 1;
}

/** Имя листа — не длиннее 31 знака и без знаков, запрещённых Excel. */
function sheetName(name: string): string {
  return name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31);
}

// ── Листы ────────────────────────────────────────────────────────────────────

function summarySheet(r: PeriodReport, money: string, generated: string): Sheet {
  const t = r.totals;
  const p = r.prevTotals;
  const typ = r.typical;
  const rows: Row[] = [
    [text(`Отчёт — ${r.title}`, { fontWeight: "bold", fontSize: 16 })],
    note(reportDatesNote(r) || r.dates),
    ...(reportCompareNote(r) ? [note(reportCompareNote(r))] : []),
    blank,
    // Объединённая ячейка: соседние под ней по правилам писателя — пустые.
    [text(reportHeadline(r), { wrap: true, columnSpan: 5, height: 48, alignVertical: "top" }), null, null, null, null],
    blank,
    [head("Показатель"), head("За период", true), head("Прошлый период", true), head(typ ? "Обычно" : "", true), head("К прошлому", true)],
  ];
  const kpi = (label: string, now: number, prev: number | undefined, usual: number | undefined, color?: string) => [
    text(label),
    num(now, money, { fontWeight: "bold", ...(color ? { textColor: color } : {}) }),
    num(prev, money),
    num(usual, money),
    num(change(now, prev), CHANGE),
  ];
  rows.push(
    kpi("Доходы", t.income, p?.income, typ?.income, INCOME_TEXT),
    kpi("Расходы", t.expense, p?.expense, typ?.expense, EXPENSE_TEXT),
    [text("Чистый поток"), num(t.net, money, { fontWeight: "bold" }), num(p?.net, money), num(typ?.net, money), null],
    [text("Норма сбережений"), num(t.rate, PERCENT, { fontWeight: "bold" }), num(p?.rate, PERCENT), num(typ?.rate, PERCENT), null],
    // «Обычно» у числа операций не считается — пусто, а не ноль.
    [text("Операций"), num(t.count, INTEGER), num(p?.count, INTEGER), null, null]
  );

  if (r.capital) {
    rows.push(
      blank,
      [head(""), head(`На ${formatDate(r.range.from, "full")}`, true), head(`На ${formatDate(r.lastDay, "full")}`, true), head("Изменение", true)],
      [text("Капитал"), num(r.capital.start, money), num(r.capital.end, money, { fontWeight: "bold" }), num(r.capital.end - r.capital.start, money)]
    );
  }

  const d = r.days;
  rows.push(
    blank,
    [head("Дни"), head("", true)],
    [text("Прожито дней"), num(d.lived, INTEGER)],
    [text("Дней без трат"), num(d.noSpend, INTEGER)],
    [text("Средний расход за день"), num(d.avg, money)],
    ...(d.biggest ? [[text(`Самый дорогой день — ${formatDate(d.biggest.date, "full")}`), num(d.biggest.expense, money)]] : [])
  );

  if (r.observations.length > 0) {
    const lived = spanDays(r.range.from, r.lastDay);
    rows.push(blank, [head("Наблюдения"), head("", true), head("")]);
    for (const o of r.observations) {
      const tile = describeObservation(
        o,
        {
          period: r.isMonth ? "month" : "week",
          running: r.running ? { day: lived, days: spanDays(r.range.from, r.range.to) } : undefined,
          days: [],
        },
        r.base
      );
      rows.push([text(tile.label), text(tile.value, { align: "right", fontWeight: "bold" }), text(tile.text)]);
    }
  }

  rows.push(blank, note(`Собрано в DzenAnalytics ${generated}. Суммы — в ${r.base} по курсу на дату операции.`));
  return { sheet: "Итоги", data: rows, columns: [{ width: 38 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 14 }] };
}

function flowSheet(r: PeriodReport, money: string): Sheet {
  const byDay = r.bucket === "day";
  const rows: Row[] = [
    [head(byDay ? "День" : "Месяц"), head("Доходы", true), head("Расходы", true), head("Чистый поток", true)],
  ];
  for (const b of r.buckets) {
    rows.push([
      byDay ? date(b.key) : text(monthTitle(b.key)),
      num(b.income, money, { textColor: INCOME_TEXT }),
      num(b.expense, money, { textColor: EXPENSE_TEXT }),
      num(b.net, money),
    ]);
  }
  const sum = (f: (b: (typeof r.buckets)[number]) => number) => r.buckets.reduce((s, b) => s + f(b), 0);
  rows.push([
    text("Итого", { fontWeight: "bold", backgroundColor: TOTAL_BG }),
    num(sum((b) => b.income), money, { fontWeight: "bold", backgroundColor: TOTAL_BG }),
    num(sum((b) => b.expense), money, { fontWeight: "bold", backgroundColor: TOTAL_BG }),
    num(sum((b) => b.net), money, { fontWeight: "bold", backgroundColor: TOTAL_BG }),
  ]);
  return {
    sheet: byDay ? "По дням" : "По месяцам",
    data: rows,
    columns: [{ width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }],
    stickyRowsCount: 1,
  };
}

function categoriesSheet(r: PeriodReport, money: string): Sheet {
  const rows: Row[] = [];
  const block = (name: string, list: PeriodReport["expenseCategories"]) => {
    rows.push(title(name), [head("Категория"), head("Сумма", true), head("Доля", true), head("Прошлый период", true), head("Изменение", true)]);
    if (list.length === 0) rows.push(note("Не было"));
    for (const c of list) {
      rows.push([
        text(c.name, c.rest ? { textColor: MUTED_TEXT } : {}),
        num(c.total, money),
        num(c.share, PERCENT),
        num(c.prev, money),
        num(change(c.total, c.prev), CHANGE),
      ]);
    }
    rows.push(blank);
  };
  block("Расходы", r.expenseCategories);
  block("Доходы", r.incomeCategories);
  if (r.movers.length > 0) {
    rows.push(title("Что изменилось сильнее всего"), [head("Категория"), head("Сейчас", true), head("Было", true), head("Разница", true)]);
    for (const m of r.movers) rows.push([text(m.category), num(m.now, money), num(m.prev, money), num(m.now - m.prev, money)]);
  }
  return { sheet: "Категории", data: rows, columns: [{ width: 34 }, { width: 18 }, { width: 10 }, { width: 18 }, { width: 18 }] };
}

function payeesSheet(r: PeriodReport, money: string): Sheet {
  const rows: Row[] = [title("Где тратили"), [head("Получатель"), head("Сумма", true), head("Покупок", true)]];
  if (r.payees.length === 0) rows.push(note("Трат не было"));
  for (const p of r.payees) rows.push([text(p.name), num(p.total, money), num(p.count, INTEGER)]);
  rows.push(blank, title("Впервые"));
  if (r.newPayees.length === 0) rows.push(note("Новых получателей не было"));
  else {
    rows.push([head("Получатель"), head("Сумма", true), head("Покупок", true)]);
    for (const p of r.newPayees) rows.push([text(p.name), num(p.total, money), num(p.count, INTEGER)]);
    if (r.newPayeesCount > r.newPayees.length) {
      const n = r.newPayeesCount;
      rows.push(note(`Всего ${n} ${pluralRu(n, ["новый получатель", "новых получателя", "новых получателей"])}, здесь — крупнейшие`));
    }
  }
  return { sheet: "Получатели", data: rows, columns: [{ width: 38 }, { width: 18 }, { width: 10 }] };
}

function operationsSheet(r: PeriodReport, money: string): Sheet {
  const rows: Row[] = [[head("Дата"), head("Получатель"), head("Категория"), head("Сумма", true), head("Комментарий")]];
  for (const o of r.operations) {
    rows.push([date(o.date), text(o.payee || "—"), text(o.category), num(o.amount, money, { textColor: EXPENSE_TEXT }), text(o.comment.trim())]);
  }
  return {
    sheet: "Самое дорогое",
    data: rows,
    columns: [{ width: 12 }, { width: 30 }, { width: 26 }, { width: 16 }, { width: 50 }],
    stickyRowsCount: 1,
  };
}

function accountsSheet(r: PeriodReport, money: string): Sheet {
  const rows: Row[] = [
    [head("Счёт"), head(`На ${formatDate(r.range.from, "full")}`, true), head(`На ${formatDate(r.lastDay, "full")}`, true), head("Изменение", true)],
  ];
  for (const a of r.accounts) rows.push([text(a.label), num(a.start, money), num(a.end, money), num(a.end - a.start, money)]);
  if (r.capital) {
    const c = r.capital;
    rows.push([
      text("Капитал", { fontWeight: "bold", backgroundColor: TOTAL_BG }),
      num(c.start, money, { fontWeight: "bold", backgroundColor: TOTAL_BG }),
      num(c.end, money, { fontWeight: "bold", backgroundColor: TOTAL_BG }),
      num(c.end - c.start, money, { fontWeight: "bold", backgroundColor: TOTAL_BG }),
    ]);
  }
  rows.push(blank, note(`Остаток на начало и конец периода в ${r.base}, по курсу дня`));
  return { sheet: "Счета", data: rows, columns: [{ width: 34 }, { width: 20 }, { width: 20 }, { width: 18 }], stickyRowsCount: 1 };
}

function budgetSheet(r: PeriodReport, money: string): Sheet {
  const b = r.budget!;
  const share = (fact: number, plan: number) => num(plan > 0 ? fact / plan : null, PERCENT);
  const rows: Row[] = [
    title(`Бюджет · ${monthTitle(b.month)}`),
    note(`План и факт — как в разделе «Бюджеты»${r.running ? ", факт идущего месяца — на сегодня" : ""}`),
    blank,
    [head(""), head("План", true), head("Факт", true), head("Исполнение", true)],
    [text(b.incomeTitle), num(b.income.plan, money), num(b.income.fact, money, { textColor: INCOME_TEXT }), share(b.income.fact, b.income.plan)],
    [text("Расходы"), num(b.expense.plan, money), num(b.expense.fact, money, { textColor: EXPENSE_TEXT }), share(b.expense.fact, b.expense.plan)],
    [text("Разница"), num(b.delta.plan, money), num(b.delta.fact, money), null],
    blank,
    [head("Статья расходов"), head("План", true), head("Факт", true), head("Остаток", true), head("Исполнение", true)],
  ];
  for (const row of b.rows) {
    rows.push([
      text(row.category),
      num(row.plan, money),
      num(row.fact, money, row.fact > row.plan ? { textColor: EXPENSE_TEXT } : {}),
      num(row.plan - row.fact, money),
      share(row.fact, row.plan),
    ]);
  }
  if (Math.abs(b.unplanned) >= 0.005) rows.push([text("Вне плана", { textColor: MUTED_TEXT }), null, num(b.unplanned, money), null, null]);
  for (const g of b.groups) rows.push([text(g.category, { textColor: MUTED_TEXT }), null, num(g.fact, money), null, null]);
  const bold = { fontWeight: "bold" as const, backgroundColor: TOTAL_BG };
  rows.push([
    text("Итого расходы", bold),
    num(b.expense.plan, money, bold),
    num(b.expense.fact, money, bold),
    num(b.expense.plan - b.expense.fact, money, bold),
    num(b.expense.plan > 0 ? b.expense.fact / b.expense.plan : null, PERCENT, bold),
  ]);
  return { sheet: "Бюджет", data: rows, columns: [{ width: 34 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 14 }] };
}

/**
 * Книга целиком: листы по разделам отчёта. Счета — когда есть остатки
 * (подключён Дзен-мани), бюджет — у месяца. Отдельно от записи файла, чтобы
 * состав проверялся тестом без настоящего .xlsx.
 */
export function buildPeriodReportWorkbook(r: PeriodReport, generated: string): Sheet[] {
  const money = moneyFormat(r.base, "money");
  const sheets = [
    summarySheet(r, money, generated),
    flowSheet(r, money),
    categoriesSheet(r, money),
    payeesSheet(r, money),
    operationsSheet(r, money),
    ...(r.accounts.length > 0 ? [accountsSheet(r, money)] : []),
    ...(r.budget ? [budgetSheet(r, money)] : []),
  ];
  return sheets.map((s) => ({ ...s, sheet: sheetName(s.sheet) }));
}

export async function downloadReportXlsx(r: PeriodReport, generated: string, fileName: string): Promise<void> {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const blob = await writeXlsxFile(buildPeriodReportWorkbook(r, generated) as never).toBlob();
  downloadBlob(blob, fileName);
}
