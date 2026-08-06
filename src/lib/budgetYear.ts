import type { Transaction } from "../types";
import { plannedFor, type BudgetKind, type BudgetLine } from "./budgets";
import { ALL_ACCOUNTS, budgetHits, TRANSFER_CATEGORY, type BudgetScope } from "./budgetScope";

/**
 * Годовой свод бюджета: двенадцать месяцев плана и факта по статьям, с итогами
 * по строке, по месяцу и за год.
 *
 * Это тот самый «бюджет предприятия в упрощённом виде», ради которого раздел и
 * задумывался: помесячная сетка, а не одна карточка текущего месяца. Считает
 * чистая функция — таблица на экране и печатная версия обязаны совпадать.
 */

export interface YearCell {
  plan: number;
  fact: number;
}

export interface YearRow {
  key: string;
  kind: BudgetKind;
  category: string;
  /** null = сам родительский тег. */
  subcategory: string | null;
  /** Двенадцать ячеек, январь → декабрь. */
  cells: YearCell[];
  plan: number;
  fact: number;
}

export interface YearGroup {
  category: string;
  /** Строка самого родительского тега (нули, если своего плана и трат нет). */
  parent: YearRow;
  subs: YearRow[];
  /** Свод по категории: родитель + под-категории. */
  total: YearRow;
  /** Статья переводов, а не настоящих трат: в чистый итог не входит. */
  transfer?: boolean;
}

export interface YearSection {
  kind: BudgetKind;
  groups: YearGroup[];
  /**
   * Итог по НАСТОЯЩИМ статьям раздела, помесячно, — без переводов. Это ответ
   * на вопрос «сколько потрачено», и подменять его оборотом нельзя.
   */
  totals: YearCell[];
  plan: number;
  fact: number;
  /**
   * Итог вместе с переводами — «сколько прошло по счетам». Совпадает с
   * `totals`, когда переводы выключены или их не было.
   */
  totalsAll: YearCell[];
  planAll: number;
  factAll: number;
}

export interface BudgetYearReport {
  year: number;
  /** «YYYY-MM» двенадцати месяцев года. */
  months: string[];
  expense: YearSection;
  income: YearSection;
  /** Доходы − расходы, помесячно. */
  delta: YearCell[];
}

/**
 * Разница между планом и фактом — так, чтобы «больше нуля» ВСЕГДА значило
 * «хорошо».
 *
 * У расхода это остаток: сколько ещё можно потратить, план минус факт. У дохода
 * наоборот — насколько перевыполнили, факт минус план. Одна формула на оба
 * случая соврала бы в половине таблицы: перерасход и недобор — разные беды, но
 * обе должны быть красными.
 */
export function yearDiff(cell: YearCell, kind: BudgetKind): number {
  return kind === "income" ? cell.fact - cell.plan : cell.plan - cell.fact;
}

/** Есть ли в разделе переводы — от этого зависит вторая строка итога. */
export function hasTransfers(section: YearSection): boolean {
  return section.groups.some((g) => g.transfer);
}

const MONTHS = 12;

function emptyCells(): YearCell[] {
  return Array.from({ length: MONTHS }, () => ({ plan: 0, fact: 0 }));
}

function rowKey(kind: string, category: string, sub: string | null): string {
  return [kind, category, sub ?? ""].join(" ");
}

function addInto(dst: YearCell[], src: YearCell[]): void {
  for (let i = 0; i < MONTHS; i++) {
    dst[i].plan += src[i].plan;
    dst[i].fact += src[i].fact;
  }
}

function totalsOf(cells: YearCell[]): { plan: number; fact: number } {
  let plan = 0;
  let fact = 0;
  for (const c of cells) {
    plan += c.plan;
    fact += c.fact;
  }
  return { plan, fact };
}

/**
 * Свод за год `year` по строкам бюджета и операциям.
 *
 * В таблицу попадают и статьи БЕЗ плана, но с тратами: годовой отчёт, где
 * потраченного не видно, отчётом не является. Операции без категории не
 * считаются, переводы — только со включённой настройкой «Учитывать переводы»
 * (тогда отдельной статьёй «Переводы» и в расходах, и в доходах).
 */
export function buildBudgetYear(
  lines: BudgetLine[],
  transactions: Transaction[],
  year: number,
  scope: BudgetScope = ALL_ACCOUNTS
): BudgetYearReport {
  const months = Array.from(
    { length: MONTHS },
    (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`
  );
  const slot = new Map(months.map((m, i) => [m, i]));

  const rows = new Map<string, YearRow>();
  const rowFor = (
    kind: BudgetKind,
    category: string,
    subcategory: string | null
  ): YearRow => {
    const key = rowKey(kind, category, subcategory);
    let r = rows.get(key);
    if (!r) {
      r = { key, kind, category, subcategory, cells: emptyCells(), plan: 0, fact: 0 };
      rows.set(key, r);
    }
    return r;
  };

  // План — из строк бюджета: план есть и у месяцев без единой операции.
  for (const l of lines) {
    const r = rowFor(l.kind, l.category, l.subcategory ?? null);
    for (let i = 0; i < MONTHS; i++) r.cells[i].plan += plannedFor(l, months[i]);
  }

  // Факт — из операций.
  for (const t of transactions) {
    const i = slot.get((t.date || "").slice(0, 7));
    if (i === undefined) continue;
    // Попаданий может быть два: у перевода списание идёт в расходы, а
    // зачисление — в доходы.
    for (const hit of budgetHits(t, scope))
      rowFor(hit.kind, hit.category, hit.subcategory).cells[i].fact += hit.amount;
  }

  for (const r of rows.values()) Object.assign(r, totalsOf(r.cells));

  const section = (kind: BudgetKind): YearSection => {
    const byCat = new Map<string, { parent?: YearRow; subs: YearRow[] }>();
    for (const r of rows.values()) {
      if (r.kind !== kind) continue;
      // Пустая строка — ни плана, ни факта за весь год — в отчёте лишняя.
      if (r.plan === 0 && r.fact === 0) continue;
      let g = byCat.get(r.category);
      if (!g) {
        g = { subs: [] };
        byCat.set(r.category, g);
      }
      if (r.subcategory) g.subs.push(r);
      else g.parent = r;
    }

    const groups: YearGroup[] = [];
    for (const [category, g] of byCat) {
      const parent =
        g.parent ??
        {
          key: rowKey(kind, category, null),
          kind,
          category,
          subcategory: null,
          cells: emptyCells(),
          plan: 0,
          fact: 0,
        };
      const cells = emptyCells();
      addInto(cells, parent.cells);
      for (const s of g.subs) addInto(cells, s.cells);
      groups.push({
        category,
        parent,
        subs: g.subs.sort((a, b) => b.fact - a.fact || b.plan - a.plan),
        total: {
          key: `${rowKey(kind, category, null)} итого`,
          kind,
          category,
          subcategory: null,
          cells,
          ...totalsOf(cells),
        },
        ...(category === TRANSFER_CATEGORY ? { transfer: true } : {}),
      });
    }
    // Переводы — всегда первой строкой: это не статья расходов в ряду прочих,
    // а оборот по счетам, и искать его среди «Еды» и «Дома» по величине суммы
    // неудобно. Остальные — по факту, как и раньше.
    groups.sort(
      (a, b) =>
        Number(!!b.transfer) - Number(!!a.transfer) ||
        b.total.fact - a.total.fact ||
        b.total.plan - a.total.plan
    );

    // Два итога: чистый (сколько потрачено/получено) и с переводами (сколько
    // прошло по счетам). Совпадают, когда переводы выключены.
    const totals = emptyCells();
    const totalsAll = emptyCells();
    for (const g of groups) {
      addInto(totalsAll, g.total.cells);
      if (!g.transfer) addInto(totals, g.total.cells);
    }
    const all = totalsOf(totalsAll);
    return {
      kind,
      groups,
      totals,
      ...totalsOf(totals),
      totalsAll,
      planAll: all.plan,
      factAll: all.fact,
    };
  };

  const expense = section("expense");
  const income = section("income");
  // Разница считается по полным итогам: перевод внутри бюджета даёт и расход, и
  // доход, они гасятся; перевод наружу оставляет только одну ногу — и это
  // настоящий отток, который обязан быть виден в разнице.
  const delta = Array.from({ length: MONTHS }, (_, i) => ({
    plan: income.totalsAll[i].plan - expense.totalsAll[i].plan,
    fact: income.totalsAll[i].fact - expense.totalsAll[i].fact,
  }));

  return { year, months, expense, income, delta };
}
