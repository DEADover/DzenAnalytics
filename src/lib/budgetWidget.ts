/**
 * Строки виджета «Бюджет месяца» на главной: расходные статьи с планом, от
 * самой «горячей» к самой спокойной.
 *
 * План и факт приходят готовыми из расчёта раздела «Бюджет»
 * (`budgetPlanRows`), чтобы виджет и раздел не разошлись ни в одной сумме.
 * Здесь отбор, порядок и сборка категорий с подкатегориями.
 *
 * Категория с подкатегориями (#141) — одна строка на всю ветку. В расчёте
 * раздела строка категории берёт только траты, у которых своей строки нет:
 * когда план задан по подкатегориям, у категории выходил ноль трат при
 * полном плане, будто в «Жильё» никто не платил. Теперь у категории — вся
 * ветка целиком, а подкатегории стоят под ней разбивкой.
 */

import type { BudgetMonthRow } from "./budgetMonth";
import { sumMoney } from "./money";

export interface BudgetWidgetRow {
  key: string;
  category: string;
  subcategory: string | null;
  planned: number;
  fact: number;
  /** Какая доля плана потрачена; больше единицы — перерасход. */
  ratio: number;
  /** План — прогноз, а не заданная сумма. */
  forecast: boolean;
  /** Подкатегории под строкой категории — разбивка её суммы. */
  children?: BudgetWidgetRow[];
}

export interface BudgetWidget {
  /** Статьи с планом — категории с ветками, самые потраченные первыми. */
  rows: BudgetWidgetRow[];
  /** Сколько статей считаются по отдельности: перерасход и остаток — по ним. */
  total: number;
  /** У скольких статей план уже превышен. */
  over: number;
  /** На сколько превышены планы — сумма перерасходов по статьям. */
  overBy: number;
  /** Сколько ещё можно потратить по планам, где они не превышены. */
  left: number;
}

const OVER_EPS = 0.5;

function widgetRow(
  key: string,
  category: string,
  subcategory: string | null,
  planned: number,
  fact: number,
  forecast: boolean
): BudgetWidgetRow {
  return { key, category, subcategory, planned, fact, ratio: planned > 0 ? fact / planned : 0, forecast };
}

const byHeat = (a: BudgetWidgetRow, b: BudgetWidgetRow) =>
  // При равной доле выше та статья, где на кону больше денег.
  b.ratio - a.ratio || b.planned - a.planned;

export function buildBudgetWidget(rows: readonly BudgetMonthRow[]): BudgetWidget {
  const byCategory = new Map<string, { parent: BudgetMonthRow | null; subs: BudgetMonthRow[] }>();
  for (const r of rows) {
    if (r.line.kind !== "expense") continue;
    if (r.planGroup || r.opening || r.unplanned) continue;
    const sub = r.line.subcategory ?? null;
    // Подкатегория без своего плана в виджет не идёт, как и раньше. А вот
    // категорию без своего плана держим, если у неё есть подкатегории: её
    // собственные траты — часть ветки.
    if (!(r.planned > 0) && sub !== null) continue;
    let g = byCategory.get(r.line.category);
    if (!g) {
      g = { parent: null, subs: [] };
      byCategory.set(r.line.category, g);
    }
    if (sub === null) g.parent = r;
    else g.subs.push(r);
  }

  const out: BudgetWidgetRow[] = [];
  /** Статьи, которые считаются по отдельности: перебор одной не гасится другой. */
  const counted: { planned: number; fact: number; left: number }[] = [];
  const article = (planned: number, fact: number) => ({ planned, fact, left: Math.max(0, planned - fact) });
  for (const [category, { parent, subs }] of byCategory) {
    const parentPlanned = parent && parent.planned > 0 ? parent.planned : 0;
    if (subs.length === 0) {
      if (!parent || !(parent.planned > 0)) continue;
      out.push(widgetRow(`${category}|`, category, null, parent.planned, parent.fact, parent.forecast));
      counted.push(article(parent.planned, parent.fact));
      continue;
    }
    if (!parent && subs.length === 1) {
      const s = subs[0];
      const sub = s.line.subcategory ?? null;
      out.push(widgetRow(`${category}|${sub ?? ""}`, category, sub, s.planned, s.fact, s.forecast));
      counted.push(article(s.planned, s.fact));
      continue;
    }
    // Замок на категории — «вся категория целиком»: её сумма уже включает
    // подкатегории, и их планы к ней не прибавляются (как `rowPlanForTotal`).
    const locked = !!parent?.locked && parentPlanned > 0;
    // Без замка — своя сумма категории плюс подкатегории. Отрицательная своя
    // сумма — поправка Дзен-мани к сумме подкатегорий, её тоже складываем.
    const planned = locked
      ? parentPlanned
      : sumMoney([parent?.planned ?? 0, ...subs.map((s) => s.planned)]);
    // Факт категории в расчёте раздела — без подкатегорий со своей строкой;
    // ветка целиком — это он плюс они.
    const fact = sumMoney([parent?.fact ?? 0, ...subs.map((s) => s.fact)]);
    const children = subs
      .map((s) =>
        widgetRow(
          `${category}|${s.line.subcategory ?? ""}`,
          category,
          s.line.subcategory ?? null,
          s.planned,
          s.fact,
          s.forecast
        )
      )
      .sort(byHeat);
    const head = widgetRow(
      `${category}|`,
      category,
      null,
      planned,
      fact,
      !!parent?.forecast || (parentPlanned === 0 && subs.every((s) => s.forecast))
    );
    out.push({ ...head, children });
    if (locked) {
      // Как в «Планах» Дзен-мани: остаток запертой категории не меньше суммы
      // остатков подкатегорий, а полный план — большая из двух сумм. Категория
      // на 2 000 ₽ с подкатегорией на 26 703 ₽ и тратами 15 318 ₽ оставляет в
      // планах 12 202 ₽, а не ноль.
      const subsLeft = sumMoney(subs.map((s) => Math.max(0, s.planned - s.fact)));
      counted.push({
        planned: Math.max(planned, sumMoney(subs.map((s) => s.planned))),
        fact,
        left: Math.max(0, planned - fact, subsLeft),
      });
    } else {
      if (parentPlanned > 0) counted.push(article(parentPlanned, parent?.fact ?? 0));
      for (const s of subs) counted.push(article(s.planned, s.fact));
    }
  }
  out.sort(byHeat);

  // Перебор — траты сверх той части плана, которая уже выбрана.
  const overOf = (r: (typeof counted)[number]) => r.fact - (r.planned - r.left);
  const overRows = counted.filter((r) => overOf(r) > OVER_EPS);
  return {
    rows: out,
    total: counted.length,
    over: overRows.length,
    overBy: sumMoney(overRows.map(overOf)),
    left: sumMoney(counted.map((r) => r.left)),
  };
}
