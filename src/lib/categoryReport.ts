/**
 * Сводный отчёт «доходы и расходы по категориям» (issue #54).
 *
 * Строки — категории (подкатегории вложены в родителя), столбцы — периоды:
 * месяцы, кварталы, годы или один столбец «за всё время». Ровно та таблица,
 * которую люди собирают руками в Гугл-таблице, когда хотят увидеть всю историю
 * ведения бюджета одним экраном.
 *
 * Классификация операций — как везде в приложении: доход это `income`, расход
 * это `expense` минус `refund` (возврат гасит трату, а не считается доходом),
 * переводы между своими счетами в отчёт не попадают вовсе.
 */

import { periodKey } from "./period";
import { monthLabel } from "./format";
import { expenseDelta } from "./txKindStyle";
import { NO_CATEGORY } from "./zenmoneyMap";
import type { Transaction } from "../types";

export type ReportScale = "month" | "quarter" | "year" | "total";

export const SCALE_LABELS: Record<ReportScale, string> = {
  month: "Месяцы",
  quarter: "Кварталы",
  year: "Годы",
  total: "Всего одним столбцом",
};


export interface ReportColumn {
  /** Ключ периода: «2026-07» / «2026-Q3» / «2026» / «all». */
  key: string;
  label: string;
}

export interface ReportRow {
  /** `categoryFull` — уникальный ключ строки. */
  key: string;
  /** Что показываем в ячейке: для подкатегории — только её собственное имя. */
  label: string;
  /** Родительская категория (для подкатегории) либо null. */
  parent: string | null;
  depth: 0 | 1;
  /** Суммы по столбцам, в том же порядке, что и `columns`. */
  values: number[];
  total: number;
  /** У родителя есть собственные операции (без подкатегории). Нужно, чтобы
   *  отличать «шапку группы» от строки с собственными суммами. */
  ownTotal: number;
}

export interface CategoryReport {
  columns: ReportColumn[];
  income: ReportRow[];
  expense: ReportRow[];
  incomeTotals: number[];
  expenseTotals: number[];
  /** Доход минус расход по каждому столбцу. */
  netTotals: number[];
  incomeTotal: number;
  expenseTotal: number;
  netTotal: number;
}

/** Ключ периода для даты операции с учётом выбранной шкалы. */
export function scaleKey(
  isoDate: string,
  scale: ReportScale,
  monthStartDay: number
): string {
  if (scale === "total") return "all";
  const ym = periodKey(isoDate, monthStartDay);
  if (scale === "month") return ym;
  const [y, m] = ym.split("-");
  if (scale === "year") return y;
  return `${y}-Q${Math.floor((Number(m) - 1) / 3) + 1}`;
}

function columnLabel(key: string, scale: ReportScale): string {
  if (scale === "total") return "За всё время";
  if (scale === "month") return monthLabel(key);
  if (scale === "year") return key;
  const [y, q] = key.split("-");
  return `${q} ${y}`;
}

/** Накопитель: строка (categoryFull) → период → сумма. Родителя и подкатегорию
 *  берём из полей операции, а не разбором строки, — в названии категории вполне
 *  может встретиться сам разделитель. */
interface AccRow {
  parent: string;
  leaf: string | null;
  cols: Map<string, number>;
}
interface Acc {
  byRow: Map<string, AccRow>;
}

function addTo(
  acc: Acc,
  rowKey: string,
  parent: string,
  leaf: string | null,
  col: string,
  amount: number
): void {
  let row = acc.byRow.get(rowKey);
  if (!row) {
    row = { parent, leaf, cols: new Map() };
    acc.byRow.set(rowKey, row);
  }
  row.cols.set(col, (row.cols.get(col) ?? 0) + amount);
}

/**
 * Собрать отчёт.
 *
 * `columnKeys` определяются по самим операциям — пустые периоды между первой и
 * последней операцией НЕ достраиваются: таблица и так широкая, а дыры в истории
 * ведения бюджета — нормальная ситуация.
 */
export function buildCategoryReport(
  txs: Transaction[],
  scale: ReportScale,
  monthStartDay: number = 1
): CategoryReport {
  const colKeys = new Set<string>();
  const incomeAcc: Acc = { byRow: new Map() };
  const expenseAcc: Acc = { byRow: new Map() };

  for (const t of txs) {
    if (!t.date) continue;
    const isIncome = t.kind === "income";
    const delta = isIncome ? t.amountBase : expenseDelta(t);
    // Переводы и долги дают 0 в обеих ветках — просто пропускаем.
    if (delta === 0 && !isIncome) continue;
    if (!isIncome && t.kind !== "expense" && t.kind !== "refund") continue;

    const col = scaleKey(t.date, scale, monthStartDay);
    colKeys.add(col);
    const parent = t.category || NO_CATEGORY;
    const leaf = t.subcategory || null;
    const rowKey = t.categoryFull || parent;
    addTo(isIncome ? incomeAcc : expenseAcc, rowKey, parent, leaf, col, delta);
  }

  const columns: ReportColumn[] = Array.from(colKeys)
    .sort()
    .map((key) => ({ key, label: columnLabel(key, scale) }));

  const income = buildRows(incomeAcc, columns);
  const expense = buildRows(expenseAcc, columns);

  const incomeTotals = sumRows(income, columns.length);
  const expenseTotals = sumRows(expense, columns.length);
  const netTotals = incomeTotals.map((v, i) => v - expenseTotals[i]);
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

  return {
    columns,
    income,
    expense,
    incomeTotals,
    expenseTotals,
    netTotals,
    incomeTotal: sum(incomeTotals),
    expenseTotal: sum(expenseTotals),
    netTotal: sum(netTotals),
  };
}

/**
 * Разложить накопленные суммы в строки: родитель, под ним — его подкатегории.
 *
 * Суммы родителя включают подкатегории (иначе строка «Еда» показывала бы
 * только операции, которым забыли проставить подкатегорию, — и итог группы не
 * сходился бы с суммой видимых строк). Собственные операции родителя
 * сохраняются отдельно в `ownTotal`.
 */
function buildRows(acc: Acc, columns: ReportColumn[]): ReportRow[] {
  const idx = new Map(columns.map((c, i) => [c.key, i]));
  const parents = new Map<string, ReportRow>();
  const children = new Map<string, ReportRow[]>();

  const emptyRow = (key: string, label: string, parent: string | null): ReportRow => ({
    key,
    label,
    parent,
    depth: parent ? 1 : 0,
    values: new Array(columns.length).fill(0),
    total: 0,
    ownTotal: 0,
  });

  for (const [full, { parent, leaf, cols }] of acc.byRow) {
    let prow = parents.get(parent);
    if (!prow) {
      prow = emptyRow(parent, parent, null);
      parents.set(parent, prow);
    }
    const target = leaf == null ? prow : emptyRow(full, leaf, parent);
    for (const [colKey, amount] of cols) {
      const i = idx.get(colKey);
      if (i == null) continue;
      target.values[i] += amount;
      target.total += amount;
      if (leaf == null) {
        // Собственные операции родителя — копим отдельно: строки приходят в
        // произвольном порядке, и присвоить ownTotal «в конце» нельзя.
        prow.ownTotal += amount;
      } else {
        prow.values[i] += amount;
        prow.total += amount;
      }
    }
    if (leaf != null) {
      const list = children.get(parent) ?? [];
      list.push(target);
      children.set(parent, list);
    }
  }

  const out: ReportRow[] = [];
  // По алфавиту. Сортировка по убыванию суммы (как было раньше) для сводника
  // читается «вразнобой»: глаз ищет конкретную статью, а её место в списке
  // зависит от сумм и переезжает при каждой смене периода.
  const cmp = (a: ReportRow, b: ReportRow) => a.label.localeCompare(b.label, "ru");
  // «Без категории» всегда последней — она про недоделанную разметку, а не про
  // траты; по алфавиту она иначе всплывала бы к «Б», в середину списка.
  const sorted = Array.from(parents.values()).sort((a, b) => {
    const aNo = a.key === NO_CATEGORY;
    const bNo = b.key === NO_CATEGORY;
    if (aNo !== bNo) return aNo ? 1 : -1;
    return cmp(a, b);
  });
  for (const p of sorted) {
    out.push(p);
    out.push(...(children.get(p.key) ?? []).sort(cmp));
  }
  return out;
}

function sumRows(rows: ReportRow[], width: number): number[] {
  const out = new Array(width).fill(0);
  for (const r of rows) {
    // Только родители — иначе подкатегории посчитались бы дважды.
    if (r.depth !== 0) continue;
    for (let i = 0; i < width; i++) out[i] += r.values[i];
  }
  return out;
}
