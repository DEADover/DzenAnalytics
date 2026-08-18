import type { Transaction } from "../types";
import {
  compareBudgetRows,
  lockedFor,
  plannedFor,
  type BudgetKind,
  type BudgetLine,
  type BudgetRowOrder,
} from "./budgets";
import { ALL_ACCOUNTS, budgetHits, TRANSFER_CATEGORY, type BudgetScope } from "./budgetScope";
import type { PlannedPlan } from "./plannedPlans";
import { nameKey, normalizeTagName } from "./budgetLines";

/**
 * Есть ли по строке что показывать: движение за год ИЛИ назначенная операция.
 *
 * Одна на всех: категории и под-категории отбираются одним правилом. Пока
 * правил было два — у категорий с оглядкой на назначенные операции, у
 * под-категорий только по факту, — под-категория, у которой на месяц назначена
 * оплата и больше ничего, пропадала со страницы, хотя её сумма входила в план
 * категории.
 *
 * Допуск в половину копейки: суммы приходят в базовой валюте, после пересчёта
 * по курсу дня в них остаются хвосты вроде 0,004 — на экране это всё равно
 * «0», и строка из нулей считалась бы «с движением».
 */
export function rowIsLive(row: { fact: number; scheduled?: boolean }): boolean {
  return Math.abs(row.fact) >= 0.005 || !!row.scheduled;
}

/**
 * Ключ пути статьи для сверки с живым справочником. Нормализация та же, что у
 * склейки строк: регистр и пробелы категорию не различают.
 */
export function categoryPathKey(
  category: string,
  subcategory: string | null | undefined
): string {
  return `${normalizeTagName(category)}\u0000${normalizeTagName(subcategory)}`;
}

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
  /** Месяцы, где план категории задан точной суммой (замок Дзен-мани): в них
   *  планы под-категорий В НЕГО УЖЕ ВХОДЯТ и второй раз не складываются. */
  locked?: boolean[];
  /** План (хотя бы за один месяц) взят из назначенной операции Дзен-мани.
   *  Такую строку не прячут как «без операций»: операции ещё не было по
   *  определению, но дата и сумма известны. */
  scheduled?: boolean;
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

/**
 * Ключ строки свода. Имена нормализуются (см. `budgetLines`): невидимая
 * разница — хвостовой или неразрывный пробел — раньше разводила одну статью на
 * две строки, и итог категории складывался из обеих.
 */
function rowKey(kind: string, category: string, sub: string | null): string {
  return nameKey(kind as BudgetKind, category, sub);
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
  scope: BudgetScope = ALL_ACCOUNTS,
  order: BudgetRowOrder = "alpha",
  /**
   * План из назначенных операций Дзен-мани — для статей, у которых своего
   * плана на этот месяц нет. Где план есть, он и остаётся: Дзен-мани уже
   * прибавил к нему запланированные операции сам, и второй раз их считать
   * нельзя (см. `plannedPlans`).
   */
  planned: PlannedPlan[] = [],
  /**
   * Пути живых категорий («Еда» / «Еда\u0000Кафе») — если известны.
   *
   * Строка бюджета хранит категорию текстом, и категорию, переименованную в
   * Дзен-мани, из старых строк никто не вычищает. Такая строка держит план,
   * факта у неё нет и быть не может — весь факт уехал на новое имя, — и она
   * висит в отчёте призраком (#77). Здесь такие и отсекаются: НУЛЕВОЙ ФАКТ ЗА
   * ВЕСЬ ГОД плюс имени нет среди живых. Живая статья с планом и без трат
   * остаётся: показать её и есть смысл плана. История удалённой категории с
   * фактом тоже остаётся — из отчёта прошлое не вычёркивают.
   *
   * Не передали (режим CSV, где живого справочника нет) — ничего не режем.
   */
  knownPaths?: Set<string>
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
    for (let i = 0; i < MONTHS; i++) {
      r.cells[i].plan += plannedFor(l, months[i]);
      if (lockedFor(l, months[i])) {
        if (!r.locked) r.locked = Array.from({ length: MONTHS }, () => false);
        r.locked[i] = true;
      }
    }
  }

  // План из назначенных операций — только туда, где своего плана нет. Строку
  // при этом заводим: статья с назначенной оплатой должна быть видна в своде
  // до самого списания, а не появляться задним числом.
  for (const p of planned) {
    const i = slot.get(p.ym);
    if (i === undefined) continue;
    const r = rowFor(p.kind, p.category, p.subcategory);
    if (r.cells[i].plan === 0) {
      r.cells[i].plan = p.amount;
      r.scheduled = true;
    }
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
      // Призрак переименования: плана хватило, чтобы пройти отсев выше, но
      // факта нет и имени в справочнике больше нет.
      if (
        r.fact === 0 &&
        knownPaths &&
        r.category !== TRANSFER_CATEGORY &&
        !knownPaths.has(categoryPathKey(r.category, r.subcategory))
      )
        continue;
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
      // Свод категории: факт складывается всегда, а ПЛАН под-категорий — только
      // в месяцах без замка. Залоченный план категории Дзен-мани считает целым:
      // «Животные 36 000» — это вся категория, «Кот» и «Собака» уже внутри.
      const cells = emptyCells();
      addInto(cells, parent.cells);
      for (const s of g.subs) {
        for (let i = 0; i < MONTHS; i++) {
          cells[i].fact += s.cells[i].fact;
          if (!parent.locked?.[i]) cells[i].plan += s.cells[i].plan;
        }
      }
      groups.push({
        category,
        parent,
        // Под-категории — тем же порядком, что и категории: список, где статьи
        // по алфавиту, а внутри них по сумме, читается как несортированный.
        subs: g.subs.sort((a, b) =>
          compareBudgetRows(
            { name: a.subcategory ?? "", amount: a.fact },
            { name: b.subcategory ?? "", amount: b.fact },
            order
          )
        ),
        total: {
          key: `${rowKey(kind, category, null)} итого`,
          kind,
          category,
          subcategory: null,
          cells,
          ...totalsOf(cells),
          // Признак поднимается на свод категории: прячет и показывает список
          // именно его, а не отдельные под-категории.
          scheduled: parent.scheduled || g.subs.some((x) => x.scheduled),
        },
        ...(category === TRANSFER_CATEGORY ? { transfer: true } : {}),
      });
    }
    // Порядок статей — по настройке раздела, а переводы всегда в самом низу:
    // это не статья расходов в ряду прочих, а оборот по счетам (issue #68).
    groups.sort((a, b) =>
      compareBudgetRows(
        { name: a.category, amount: a.total.fact, transfer: a.transfer },
        { name: b.category, amount: b.total.fact, transfer: b.transfer },
        order
      )
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
