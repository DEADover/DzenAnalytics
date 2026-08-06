/**
 * Модель годового дашборда бюджета — то, из чего собирается лист Excel с
 * диаграммами.
 *
 * Считается отдельно от выгрузки и без единой ссылки на формат файла: сначала
 * ответы («сколько потратили, сколько собирались, сколько было год назад»),
 * потом уже ячейки и столбики. Так цифры на диаграмме можно проверить тестом,
 * а не глазами в Excel.
 *
 * Отдаёт данные ПО ВСЕМ ДВЕНАДЦАТИ МЕСЯЦАМ, а не только по выбранному: на
 * дашборде месяц выбирается прямо в Excel, и показатели считаются формулами по
 * этому сырью. Без него выпадашка переключала бы подпись, а цифры оставались бы
 * прежними.
 *
 * Два горизонта, как в управленческих отчётах: ВЫБРАННЫЙ МЕСЯЦ и С НАЧАЛА ГОДА
 * (январь → выбранный включительно). Прошлый год берётся ТЕМ ЖЕ отрезком:
 * сравнивать три прожитых месяца с двенадцатью прошлогодними бессмысленно.
 */

import type { BudgetKind } from "./budgets";
import { hasTransfers, yearDiff, type BudgetYearReport, type YearSection } from "./budgetYear";
import { TRANSFER_CATEGORY } from "./budgetScope";

const MONTHS = 12;

export interface DashboardRow {
  category: string;
  /** null = строка самой категории (со всеми её под-категориями внутри). */
  subcategory: string | null;
  /**
   * Подпись на диаграмме. У под-категории она полная («Еда · Кафе»): на оси
   * диаграммы нет отступов и родителя рядом не видно, а «Кафе» само по себе не
   * отвечает на вопрос «чьё».
   */
  label: string;
  /** Двенадцать месяцев факта, январь → декабрь. */
  factByMonth: number[];
  planByMonth: number[];
  /** Двенадцать месяцев прошлого года; нули, если статьи тогда не было. */
  prevFactByMonth: number[];
}

/** Свод раздела (расходы или доходы) по двенадцати месяцам. */
export interface DashboardTotals {
  factByMonth: number[];
  planByMonth: number[];
  /** Факт вместе с переводами — «сколько прошло по счетам». */
  factAllByMonth: number[];
  prevFactByMonth: number[];
  /** Прошлый год тем же счётом — чистый и с переводами. */
  prevFactAllByMonth: number[];
  /** В разделе есть переводы: строку «включая переводы» показывать есть смысл. */
  hasTransfers: boolean;
}

export interface BudgetDashboard {
  year: number;
  /** «YYYY-MM» месяца, выбранного при выгрузке, — начальное значение выпадашки. */
  month: string;
  monthIndex: number;
  expense: DashboardTotals;
  income: DashboardTotals;
  /**
   * Все статьи расходов с под-категориями — основа диаграмм. Категория идёт
   * своим итогом (вместе с под-категориями), сразу за ней — её под-категории.
   */
  rows: DashboardRow[];
}

/** Значение месяца `m` (0-инд.). */
export function atMonth(values: number[], m: number): number {
  return values[m] ?? 0;
}

/** Сумма с января по месяц `m` включительно. */
export function ytd(values: number[], m: number): number {
  let s = 0;
  for (let i = 0; i <= m; i++) s += values[i] ?? 0;
  return s;
}

/**
 * Факт предыдущего месяца. У января это декабрь ПРОШЛОГО года, а не «ничего»:
 * иначе рост «месяц к месяцу» в январе всегда был бы пустым, хотя он есть.
 */
export function prevMonth(values: number[], prevYear: number[], m: number): number {
  return m === 0 ? (prevYear[MONTHS - 1] ?? 0) : (values[m - 1] ?? 0);
}

function factCells(cells: { fact: number }[]): number[] {
  return Array.from({ length: MONTHS }, (_, i) => cells[i]?.fact ?? 0);
}

function planCells(cells: { plan: number }[]): number[] {
  return Array.from({ length: MONTHS }, (_, i) => cells[i]?.plan ?? 0);
}

function totalsOf(section: YearSection, prev: YearSection): DashboardTotals {
  return {
    factByMonth: factCells(section.totals),
    planByMonth: planCells(section.totals),
    factAllByMonth: factCells(section.totalsAll),
    prevFactByMonth: factCells(prev.totals),
    prevFactAllByMonth: factCells(prev.totalsAll),
    hasTransfers: hasTransfers(section),
  };
}

/**
 * Доля выполнения плана, 0…1+.
 *
 * План в нуле — деления нет: у статьи без плана «процент выполнения» не
 * определён, и подставить туда 0% или 100% значит соврать в обе стороны.
 * Возвращаем `null`, а выгрузка рисует прочерк.
 */
export function achievement(fact: number, plan: number): number | null {
  if (plan === 0) return null;
  return fact / plan;
}

/** Рост к базе, 0.12 = +12%. База в нуле — роста нет (не «бесконечность»). */
export function growth(value: number, base: number): number | null {
  if (base === 0) return null;
  return (value - base) / base;
}

/** Отклонение от плана со знаком «больше нуля — хорошо» (см. `yearDiff`). */
export function variance(fact: number, plan: number, kind: BudgetKind): number {
  return yearDiff({ plan, fact }, kind);
}

/**
 * Собрать дашборд по годовому своду текущего и предыдущего года.
 *
 * `prev` может быть отчётом за год без данных — тогда сравнение с прошлым годом
 * просто выйдет нулевым, а не сломает выгрузку.
 */
export function buildBudgetDashboard(
  report: BudgetYearReport,
  prev: BudgetYearReport,
  monthIndex: number
): BudgetDashboard {
  const m = Math.min(MONTHS - 1, Math.max(0, monthIndex));

  // Прошлый год ищем по паре «категория + под-категория»: у под-категорий
  // имена повторяются между категориями («Кафе» может быть и у «Еды», и у
  // «Развлечений»), и ключа из одного имени мало.
  const prevKey = (category: string, sub: string | null) => `${category} ${sub ?? ""}`;
  const prevCells = new Map<string, { plan: number; fact: number }[]>();
  for (const g of prev.expense.groups) {
    prevCells.set(prevKey(g.category, null), g.total.cells);
    for (const s of g.subs) prevCells.set(prevKey(g.category, s.subcategory), s.cells);
  }

  const rowOf = (
    category: string,
    subcategory: string | null,
    label: string,
    cells: { plan: number; fact: number }[]
  ): DashboardRow => {
    const before = prevCells.get(prevKey(category, subcategory));
    return {
      category,
      subcategory,
      label,
      factByMonth: factCells(cells),
      planByMonth: planCells(cells),
      prevFactByMonth: before ? factCells(before) : Array(MONTHS).fill(0),
    };
  };

  // Строка без единого движения ЗА ВЕСЬ ГОД — это подпись напротив пустого
  // места на каждой диаграмме. Отбираем по году целиком, а не по выбранному
  // месяцу: месяц переключается уже в Excel, и набор строк меняться не должен.
  const alive = (r: DashboardRow) =>
    r.factByMonth.some((v) => v !== 0) || r.planByMonth.some((v) => v !== 0);

  // Порядок — по факту за год: сортировать под выбранный месяц нельзя, он
  // меняется в файле, а строки на листе уже записаны.
  const byYear = (a: DashboardRow, b: DashboardRow) =>
    ytd(b.factByMonth, 11) - ytd(a.factByMonth, 11) ||
    ytd(b.planByMonth, 11) - ytd(a.planByMonth, 11);

  // Переводы — первой строкой, как и в таблице на экране: оборот по счетам не
  // стоит искать среди статей по величине суммы.
  const byGroup = (
    a: { parent: DashboardRow },
    b: { parent: DashboardRow }
  ) =>
    Number(b.parent.category === TRANSFER_CATEGORY) -
      Number(a.parent.category === TRANSFER_CATEGORY) || byYear(a.parent, b.parent);

  const groups = report.expense.groups
    .map((g) => ({
      parent: rowOf(g.category, null, g.category, g.total.cells),
      subs: g.subs
        .map((s) =>
          rowOf(g.category, s.subcategory, `${g.category} · ${s.subcategory}`, s.cells)
        )
        .filter(alive)
        .sort(byYear),
    }))
    .filter((x) => alive(x.parent) || x.subs.length > 0)
    .sort(byGroup);

  return {
    year: report.year,
    month: report.months[m],
    monthIndex: m,
    expense: totalsOf(report.expense, prev.expense),
    income: totalsOf(report.income, prev.income),
    rows: groups.flatMap((x) => [x.parent, ...x.subs]),
  };
}
