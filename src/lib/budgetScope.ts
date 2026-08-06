import type { Transaction } from "../types";
import { affectsExpense, expenseDelta } from "./txKindStyle";
import type { BudgetKind } from "./budgets";
import { NO_CATEGORY } from "./zenmoneyMap";

/**
 * Периметр бюджета: какие счета в него входят и что делать с переводами.
 *
 * Со включённой настройкой «Учитывать переводы» перевод виден ОБЕИМИ ногами:
 * списание — расходом у счёта-источника, зачисление — доходом у счёта-
 * получателя. Перевод 200 ₽ между своими картами даёт +200 к расходам и +200 к
 * доходам: обороты по счетам видны, а разница «доходы − расходы» не едет, ноги
 * гасят друг друга.
 *
 * Именно поэтому итог расходов показывается ДВУМЯ строками — чистый и «включая
 * переводы»: сумма с переводами отвечает на вопрос «сколько прошло по счетам»,
 * а не «сколько я потратил», и подменять ею расход нельзя.
 *
 * Если периметр сужен до части счетов, нога учитывается только когда её счёт
 * внутри: перевод наружу — чистый отток, перевод внутрь — поступление.
 */
export interface BudgetScope {
  /** Имена счетов в бюджете. Пустой набор = все счета. */
  accounts: Set<string>;
  /** Считать переводы: списание — в расходы, зачисление — в доходы. */
  perimeterTransfers: boolean;
}

/** Статья, под которой в бюджете видны переводы. */
export const TRANSFER_CATEGORY = "Переводы";

/** Периметр из всех счетов — поведение бюджета до появления настроек. */
export const ALL_ACCOUNTS: BudgetScope = {
  accounts: new Set(),
  perimeterTransfers: false,
};

/** Как операция ложится в бюджет. */
export interface BudgetHit {
  kind: BudgetKind;
  category: string;
  subcategory: string | null;
  /** Знаковый вклад в статью: у возврата он отрицательный. */
  amount: number;
  /** Нога перевода, а не настоящий доход/расход — считается итогом отдельно. */
  transfer?: boolean;
}

/**
 * Единственное место, где решается «попадает ли операция в бюджет и куда».
 *
 * Все расчёты бюджета — факт месяца, прогноз, годовой свод, список «Без
 * бюджета» и переход к операциям — зовут её же. Иначе таблица и переход из неё
 * однажды разойдутся.
 *
 * Возвращает СПИСОК, потому что у перевода попаданий два: списание в расходы и
 * зачисление в доходы. У всего остального — одно или ни одного.
 */
export function budgetHits(t: Transaction, scope: BudgetScope): BudgetHit[] {
  const all = scope.accounts.size === 0;
  const inside = (account: string | undefined) =>
    all ? true : !!account && scope.accounts.has(account);

  if (t.kind === "transfer") {
    if (!scope.perimeterTransfers) return [];
    const out: BudgetHit[] = [];
    // Обе ноги берут сумму в БАЗОВОЙ валюте. У валютного перевода списание и
    // зачисление — разные числа в своих валютах, но в базовой это одна и та же
    // сумма; иначе перевод перестал бы гаситься и поехала бы «Разница».
    if (inside(t.outcomeAccount))
      out.push({
        kind: "expense",
        category: TRANSFER_CATEGORY,
        // Под-категория — счёт НА ТОЙ СТОРОНЕ: в расходах видно, куда ушло, в
        // доходах — откуда пришло. Свой счёт и так известен из раздела.
        subcategory: t.incomeAccount || null,
        amount: t.amountBase,
        transfer: true,
      });
    if (inside(t.incomeAccount))
      out.push({
        kind: "income",
        category: TRANSFER_CATEGORY,
        subcategory: t.outcomeAccount || null,
        amount: t.amountBase,
        transfer: true,
      });
    return out;
  }

  if (!inside(t.account)) return [];
  // «Без категории» — не статья бюджета: планировать неразобранное нечего.
  if (!t.category || t.category === NO_CATEGORY) return [];
  if (t.kind === "income")
    return [
      {
        kind: "income",
        category: t.category,
        subcategory: t.subcategory ?? null,
        amount: t.amountBase,
      },
    ];
  if (affectsExpense(t.kind))
    return [
      {
        kind: "expense",
        category: t.category,
        subcategory: t.subcategory ?? null,
        amount: expenseDelta(t),
      },
    ];
  return [];
}

/**
 * Первое попадание операции в бюджет, или null.
 *
 * Удобно там, где перевод по определению невозможен или его вторая нога не
 * нужна. Считать суммы через неё НЕЛЬЗЯ — потеряется вторая нога перевода.
 */
export function budgetHit(t: Transaction, scope: BudgetScope): BudgetHit | null {
  return budgetHits(t, scope)[0] ?? null;
}

/** Ячейка бюджета — статья определённого направления. */
export interface BudgetCell {
  /** Не задано — обе стороны: строка категории показывает всё по тегу. */
  kind?: BudgetKind;
  category: string;
  subcategory: string | null;
}

/** Операции, стоящие за ячейкой бюджета: то же правило, что и в суммах. */
export function transactionsForCell(
  transactions: Transaction[],
  scope: BudgetScope,
  cell: BudgetCell,
  ym?: string
): Transaction[] {
  return transactions.filter((t) => {
    if (ym && !(t.date || "").startsWith(ym)) return false;
    return budgetHits(t, scope).some((hit) => {
      if (cell.kind && hit.kind !== cell.kind) return false;
      return hit.category === cell.category && hit.subcategory === cell.subcategory;
    });
  });
}

/**
 * Операции внутри периметра «как есть» — для виджетов, которые считают сами
 * (график движения денег). Переводы через границу сюда не попадают: график
 * рисует доходы и расходы, а не статьи бюджета.
 */
export function insidePerimeter(
  transactions: Transaction[],
  scope: BudgetScope
): Transaction[] {
  if (scope.accounts.size === 0) return transactions;
  return transactions.filter(
    (t) => t.kind !== "transfer" && !!t.account && scope.accounts.has(t.account)
  );
}
