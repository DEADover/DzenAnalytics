/**
 * Бюджет одного месяца — статьи, их план и факт и итоги «План / Факт».
 *
 * Один расчёт на раздел «Бюджеты» (месячный вид) и на «Отчёт за период»: пока
 * отчёт считал бюджет своей упрощённой копией, его итоги расходились с
 * разделом — без «вне плана», без «Без категории», без прогнозов и назначенных
 * операций Дзен-мани, без переводов по правилам «Планов» и без входящего
 * баланса. Теперь у обоих одна функция, и разойтись им не с чего.
 *
 * Здесь только чистые функции. Источники — назначенные операции и прогнозы из
 * кэша Дзен-мани, живой справочник категорий — собирает хук
 * `useBudgetSources`.
 */

import type { Transaction } from "../types";
import {
  compareBudgetRows,
  factFor,
  forecastFor,
  lockedFor,
  ownSubsFor,
  ownSubsIndex,
  plannedFor,
  type BudgetKind,
  type BudgetLine,
  type BudgetRowOrder,
} from "./budgets";
import { budgetHits, inPerimeter, TRANSFER_CATEGORY, type BudgetHit, type BudgetScope } from "./budgetScope";
import { categoryPathKey } from "./budgetYear";
import { nameKey } from "./budgetLines";
import { txAccountKey } from "./accountKey";
import { periodRange } from "./period";
import type { PlannedPlan } from "./plannedPlans";
import { affectsExpense, expenseDelta } from "./txKindStyle";
import { zenPlanKey } from "./zenBudgets";
import { NO_CATEGORY } from "./zenmoneyMap";
import { OPENING_BALANCE_LABEL, type ZenPlanRules } from "./zenPlanRules";

export interface BudgetMonthRow {
  line: BudgetLine;
  /** План месяца: свой, прогноз Дзен-мани или сумма назначенной операции. */
  planned: number;
  fact: number;
  /** `planned` — прогноз (своего плана в этом месяце нет). */
  forecast: boolean;
  /** План задан точной суммой (замок Дзен-мани). У категории это значит «вся
   *  категория целиком»: планы подкатегорий уже внутри и не складываются. */
  locked?: boolean;
  /** План взят из назначенной операции Дзен-мани, своего плана у статьи нет. */
  scheduled?: boolean;
  /**
   * Плана у статьи нет вовсе — строка собрана из одних фактов (issue #82):
   * итог месяца обязан сходиться с лентой операций за тот же месяц. План ноль,
   * а не «нет»: ноль — честный ответ «столько собирались потратить».
   */
  unplanned?: boolean;
  /**
   * Плану тут взяться неоткуда: «Без категории» — не статья, планировать
   * неразобранное нечего. В сумму месяца эти деньги при этом входят.
   */
  plannable?: boolean;
  /**
   * Перевод через границу баланса по правилам «Планов» Дзен-мани:
   * «Накопления», «Кредиты и кредитки», «Долги»… Входит в итоги, стоит в конце
   * списка, плана у неё нет.
   */
  planGroup?: boolean;
  /** «Входящий баланс» — остаток на счетах к началу периода. */
  opening?: boolean;
}

/** Что нужно расчёту месяца, кроме самого месяца и периметра. */
export interface BudgetMonthSources {
  lines: readonly BudgetLine[];
  transactions: readonly Transaction[];
  monthStartDay: number;
  /** Прогнозы самого Дзен-мани («из X»); `null` — без подключения (CSV). */
  zenForecasts: Map<string, number> | null;
  /** Кэш прогнозов уже прочитан — до этого прогноз не показываем вовсе. */
  zenLoaded: boolean;
  zenRules: ZenPlanRules | null | undefined;
  /** План из назначенных операций — для статей без своего плана. */
  plannedAsPlan: readonly PlannedPlan[];
  /** Живые категории справочника; `null` — справочника нет (CSV). */
  livePaths: Set<string> | null;
  rowOrder: BudgetRowOrder;
}

/** Ключ статьи: тип, категория и подкатегория без различий регистра и пробелов. */
export const budgetKey = (kind: string, cat: string, sub: string | null) => nameKey(kind as BudgetKind, cat, sub);

const emptyLine = (id: string, kind: BudgetKind, category: string, subcategory: string | null, ym: string): BudgetLine => ({
  id,
  kind,
  category,
  subcategory,
  amount: 0,
  recurrence: "monthly",
  startMonth: ym,
  endMonth: null,
  createdAt: "",
});

/**
 * Статьи с планом на месяц (свой план, прогноз или назначенная операция) и их
 * факт. Функцией от месяца, а не только выбранного: прогноз входящего баланса
 * будущего месяца проходит по всем месяцам до него.
 */
export function budgetPlanRows(src: BudgetMonthSources, ym: string, scope: BudgetScope): BudgetMonthRow[] {
  const { lines, monthStartDay, zenForecasts, zenLoaded, zenRules } = src;
  const transactions = src.transactions as Transaction[];
  // Первый проход — только планы: от фактов они не зависят, а факт категории
  // зависит от того, какие под-строки в итоге окажутся на экране (issue #70).
  const inWindow = lines
    // Строка относится к месяцу, только пока он внутри её окна
    // [startMonth, endMonth]: бюджет с июня не появляется в мае.
    .filter((line) => ym >= line.startMonth && (!line.endMonth || ym <= line.endMonth))
    .map((line) => {
      const planned = plannedFor(line, ym);
      // Без своего плана — прогноз. С подключением прогноз берётся у самого
      // Дзен-мани и только если он включён в настройках «Планов» — тогда для
      // обеих сторон, как в приложении. Без подключения — своя медиана по
      // доходам.
      const wantForecast = zenForecasts ? !!zenRules?.forecasts : line.kind === "income";
      if (planned === 0 && wantForecast) {
        let fc: number;
        if (!zenLoaded) fc = 0; // кэш ещё читается — без мелькания медианы
        else if (zenForecasts) fc = zenForecasts.get(zenPlanKey(line.kind, line.category, line.subcategory ?? null, ym)) ?? 0;
        else fc = forecastFor(line, transactions, ym, 6, scope, monthStartDay);
        if (fc > 0) return { line, planned: fc, fact: 0, forecast: true } as BudgetMonthRow;
      }
      return { line, planned, fact: 0, forecast: false, locked: lockedFor(line, ym) } as BudgetMonthRow;
    });
  // Только статьи с планом в этом месяце. Подстатья без своего плана в
  // родителя не сворачивается (у Дзен-мани такие траты — «Вне плана»).
  // Отрицательный свой план категории остаётся: это поправка Дзен-мани к
  // сумме подкатегорий.
  const shown = inWindow.filter((r) => r.planned !== 0);
  // Статьи без своего плана, но с НАЗНАЧЕННОЙ на месяц операцией: сумма и
  // дата известны. Где план есть, Дзен-мани уже прибавил назначенные к нему.
  const withPlan = new Set(shown.map((r) => budgetKey(r.line.kind, r.line.category, r.line.subcategory ?? null)));
  // Факт у всех строк считается вторым проходом ниже.
  const scheduled: BudgetMonthRow[] = [];
  for (const p of src.plannedAsPlan) {
    if (p.ym !== ym) continue;
    const key = budgetKey(p.kind, p.category, p.subcategory);
    if (withPlan.has(key)) continue;
    scheduled.push({
      line: emptyLine(`scheduled:${key}`, p.kind, p.category, p.subcategory, ym),
      planned: p.amount,
      fact: 0,
      forecast: false,
      scheduled: true,
    });
  }
  const all = [...shown, ...scheduled];
  // Второй проход — факты. Строка категории забирает и траты подкатегорий,
  // кроме тех, что показаны отдельной строкой.
  const ownSubs = ownSubsIndex(all);
  const livePaths = src.livePaths;
  const budgeted = all
    .map((r): BudgetMonthRow => ({
      ...r,
      fact: factFor(r.line, transactions, ym, scope, ownSubsFor(ownSubs, r.line), monthStartDay),
    }))
    // Призрак переименования: имени в справочнике больше нет и трат за месяц
    // нет — весь факт уехал на новое имя (#77).
    .filter(
      (r) =>
        !livePaths ||
        r.fact !== 0 ||
        r.line.category === TRANSFER_CATEGORY ||
        livePaths.has(categoryPathKey(r.line.category, r.line.subcategory ?? null))
    );
  // Порядок статей — общий для раздела: по алфавиту или по сумме (issue #68).
  const catFact = new Map<string, number>();
  const catKey = (r: BudgetMonthRow) => `${r.line.kind}\u0000${r.line.category}`;
  for (const r of budgeted) catFact.set(catKey(r), (catFact.get(catKey(r)) ?? 0) + r.fact);
  return budgeted.sort((a, b) => {
    if (a.line.category !== b.line.category)
      return compareBudgetRows(
        { name: a.line.category, amount: catFact.get(catKey(a)) ?? 0 },
        { name: b.line.category, amount: catFact.get(catKey(b)) ?? 0 },
        src.rowOrder
      );
    // Внутри категории первой идёт она сама, следом её подкатегории.
    const as = a.line.subcategory ?? "";
    const bs = b.line.subcategory ?? "";
    if (!as || !bs) return as ? 1 : bs ? -1 : 0;
    return compareBudgetRows({ name: as, amount: a.fact }, { name: bs, amount: b.fact }, src.rowOrder);
  });
}

/**
 * Куда операция ложится в бюджете — одно правило на строки статей, график
 * месяца и итоги. Нога перевода «внутри периметра» (`transfer`) — не статья.
 *
 * «Без категории» `budgetHits` отсеивает — планировать неразобранное нечего,
 * но деньги потрачены, и без них итог месяца не сойдётся с операциями.
 * Собираем их отдельной строкой, которую нельзя планировать.
 */
export function budgetFactHits(t: Transaction, scope: BudgetScope): BudgetHit[] {
  if (t.kind !== "transfer" && (!t.category || t.category === NO_CATEGORY)) {
    if (!inPerimeter(scope, t.account ? txAccountKey(t) : undefined)) return [];
    if (t.kind === "income") return [{ kind: "income", category: NO_CATEGORY, subcategory: null, amount: t.amountBase }];
    if (affectsExpense(t.kind)) return [{ kind: "expense", category: NO_CATEGORY, subcategory: null, amount: expenseDelta(t) }];
    return [];
  }
  return budgetHits(t, scope);
}

/**
 * Статьи, по которым в месяце были деньги, но плана нет, — обычные строки с
 * планом 0 (issue #82). Считается ПОСЛЕ `rows`: статья попадает сюда, только
 * если её нет наверху — ни своей строкой, ни внутри плана родителя.
 */
export function budgetUnplannedRows(
  src: Pick<BudgetMonthSources, "transactions" | "monthStartDay">,
  ym: string,
  scope: BudgetScope,
  rows: readonly BudgetMonthRow[]
): BudgetMonthRow[] {
  const { from, to } = periodRange(ym, src.monthStartDay);
  const agg = new Map<string, { kind: BudgetKind; category: string; subcategory: string | null; fact: number; planGroup?: boolean }>();
  const add = (kind: BudgetKind, category: string, subcategory: string | null, amount: number, planGroup?: boolean) => {
    const key = budgetKey(kind, category, subcategory);
    const cur = agg.get(key);
    if (cur) cur.fact += amount;
    else agg.set(key, { kind, category, subcategory, fact: amount, planGroup });
  };
  for (const t of src.transactions) {
    const day = (t.date || "").slice(0, 10);
    if (day < from || day > to) continue;
    for (const hit of budgetFactHits(t, scope)) add(hit.kind, hit.category, hit.subcategory, hit.amount, hit.planGroup);
  }
  // Группа переводов — строка категории с подстроками по счетам: родителя у
  // неё в операциях нет, заводим его сами.
  for (const u of [...agg.values()]) {
    if (!u.planGroup || u.subcategory === null) continue;
    if (!agg.has(budgetKey(u.kind, u.category, null)))
      agg.set(budgetKey(u.kind, u.category, null), { kind: u.kind, category: u.category, subcategory: null, fact: 0, planGroup: true });
  }
  const shown = new Set(rows.map((r) => budgetKey(r.line.kind, r.line.category, r.line.subcategory ?? null)));
  // Подкатегория не «без плана», если план есть у её КАТЕГОРИИ (#70).
  const parentShown = (u: { kind: BudgetKind; category: string; subcategory: string | null }) =>
    u.subcategory !== null && shown.has(budgetKey(u.kind, u.category, null));
  return [...agg.values()]
    .filter(
      (u) =>
        (u.fact !== 0 || (u.planGroup && u.subcategory === null)) &&
        // Переводы — не статья бюджета: в сводке они идут своей строкой.
        u.category !== TRANSFER_CATEGORY &&
        !shown.has(budgetKey(u.kind, u.category, u.subcategory)) &&
        !parentShown(u)
    )
    .map(
      (u): BudgetMonthRow => ({
        line: emptyLine(`unplanned:${budgetKey(u.kind, u.category, u.subcategory)}`, u.kind, u.category, u.subcategory, ym),
        planned: 0,
        fact: u.fact,
        forecast: false,
        unplanned: true,
        plannable: u.category !== NO_CATEGORY && !u.planGroup,
        ...(u.planGroup ? { planGroup: true } : {}),
      })
    );
}

/** Строка «Входящий баланс» — когда он учитывается в «Планах»; будущий месяц — прогноз. */
export function openingBudgetRow(opening: number | null, ym: string, currentYm: string): BudgetMonthRow | null {
  if (opening === null) return null;
  return {
    line: emptyLine("opening", "income", OPENING_BALANCE_LABEL, null, ym),
    planned: opening,
    fact: opening,
    forecast: ym > currentYm,
    unplanned: true,
    plannable: false,
    opening: true,
  };
}

export interface BudgetMonthTotals {
  income: { plan: number; fact: number };
  expense: { plan: number; fact: number };
  /** Переводы за месяц — оборот по счетам, вне статей. */
  transfers: { income: number; expense: number };
  /** Разница «поступления − расходы»: без входящего баланса, как в приложении. */
  delta: { plan: number; fact: number };
  /** Входящий баланс, если он учитывается; иначе 0. */
  opening: number;
}

/**
 * План статьи для итога: у категории с ЗАМКОМ планы подкатегорий уже внутри
 * её числа, и прибавлять их второй раз нельзя.
 */
export function rowPlanForTotal(rows: readonly BudgetMonthRow[]): (r: BudgetMonthRow) => number {
  const lockedParents = new Set(rows.filter((r) => !r.line.subcategory && r.locked).map((r) => `${r.line.kind}\u0000${r.line.category}`));
  return (r) => (r.line.subcategory && lockedParents.has(`${r.line.kind}\u0000${r.line.category}`) ? 0 : r.planned);
}

/**
 * Итоги месяца — карточки «Поступления / Расходы / Разница» раздела. `rows` —
 * всё вместе: входящий баланс, статьи с планом и без.
 */
export function budgetMonthTotals(
  rows: readonly BudgetMonthRow[],
  src: Pick<BudgetMonthSources, "transactions" | "monthStartDay">,
  ym: string,
  scope: BudgetScope
): BudgetMonthTotals {
  const planOf = rowPlanForTotal(rows);
  const sum = (kind: BudgetKind, f: (r: BudgetMonthRow) => number) => rows.filter((r) => r.line.kind === kind).reduce((s, r) => s + f(r), 0);
  const income = { plan: sum("income", planOf), fact: sum("income", (r) => r.fact) };
  const expense = { plan: sum("expense", planOf), fact: sum("expense", (r) => r.fact) };
  // Переводы — отдельно от статей: не траты и не поступления, а оборот.
  const { from, to } = periodRange(ym, src.monthStartDay);
  const transfers = { income: 0, expense: 0 };
  for (const t of src.transactions) {
    const day = (t.date || "").slice(0, 10);
    if (day < from || day > to) continue;
    for (const hit of budgetHits(t, scope)) {
      if (!hit.transfer) continue;
      transfers[hit.kind] += hit.amount;
    }
  }
  // Переводы входят в обе части и внутри бюджета гасятся; перевод наружу —
  // настоящий отток. Входящий баланс в разницу не идёт: это остаток прошлых
  // месяцев, а не поступление этого.
  const opening = rows.find((r) => r.opening)?.fact ?? 0;
  return {
    income,
    expense,
    transfers,
    delta: {
      plan: income.plan - opening - expense.plan,
      fact: income.fact - opening + transfers.income - (expense.fact + transfers.expense),
    },
    opening,
  };
}
