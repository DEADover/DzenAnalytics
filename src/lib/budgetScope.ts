import type { Transaction } from "../types";
import { affectsExpense, expenseDelta } from "./txKindStyle";
import type { BudgetKind } from "./budgets";
import { NO_CATEGORY } from "./zenmoneyMap";
import { periodRange } from "./period";
import { categoryKey, type ZenPlanRules } from "./zenPlanRules";
import { txAccountKey, txInKey, txOutKey } from "./accountKey";

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
  /** Ключи счетов в бюджете (`lib/accountKey`). Пустой набор = все счета
   *  (кроме `excluded`). */
  accounts: Set<string>;
  /**
   * Счета, которых нет и в «все счета»: счета вне баланса, пока они не
   * считаются (Настройки → Расчёты). Так же считает сам Дзен-мани — факт
   * бюджета у него по счетам в балансе. Явно выбранных счетов не касается:
   * выбрали накопительный в периметр — он в бюджете.
   */
  excluded?: Set<string>;
  /** Считать переводы: списание — в расходы, зачисление — в доходы. */
  perimeterTransfers: boolean;
  /**
   * Правила «Планов» Дзен-мани (см. `zenPlanRules`). Работают, когда периметр —
   * все счета и своя настройка «Учитывать переводы» выключена: тогда бюджет
   * считает ровно как приложение — переводы через границу баланса строками
   * своих групп, возвраты по режиму пользователя.
   */
  zen?: ZenPlanRules;
  /** Подпись счёта по ключу — для строк переводов: у тёзок с уточнением.
   *  Не задана — название счёта из операции. */
  labelOf?: (key: string) => string;
}

/** Действуют ли сейчас правила «Планов» Дзен-мани. */
export function zenRulesOn(scope: BudgetScope): ZenPlanRules | null {
  if (!scope.zen || scope.perimeterTransfers || scope.accounts.size > 0) return null;
  return scope.zen;
}

/** Входит ли счёт в периметр — единственная проверка на весь раздел. */
export function inPerimeter(scope: BudgetScope, account: string | null | undefined): boolean {
  const zen = zenRulesOn(scope);
  // По правилам Дзен-мани периметр — счета «в балансе».
  if (zen) return !account || zen.inside.has(account);
  if (scope.accounts.size > 0) return !!account && scope.accounts.has(account);
  return !account || !scope.excluded?.has(account);
}

/** Периметр — все счета, без сужения (исключённые вне баланса не в счёт). */
export function isAllAccounts(scope: BudgetScope): boolean {
  return scope.accounts.size === 0 && !scope.excluded?.size;
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
  /**
   * Перевод через границу баланса по правилам «Планов» Дзен-мани. В отличие от
   * `transfer` это настоящая строка бюджета и входит в итоги, но плана у неё
   * нет: в Дзен-мани такой строке план не задать.
   */
  planGroup?: boolean;
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
  const inside = (account: string | undefined) => inPerimeter(scope, account);
  const zen = zenRulesOn(scope);
  const label = (key: string, title: string) => (key && scope.labelOf ? scope.labelOf(key) : title);

  if (t.kind === "transfer" && zen) {
    const outKey = txOutKey(t);
    const inKey = txInKey(t);
    const outIn = !!t.outcomeAccount && zen.inside.has(outKey);
    const inIn = !!t.incomeAccount && zen.inside.has(inKey);
    // Между своими счетами в балансе и между двумя внешними — мимо планов.
    if (outIn === inIn) return [];
    const side = outIn ? "to" : "from";
    const otherKey = outIn ? inKey : outKey;
    const other = label(otherKey, (outIn ? t.incomeAccount : t.outcomeAccount) || "");
    const group = zen.groupOf.get(otherKey) ?? "other";
    if (zen.excluded.has(`${side}:${group}`)) return [];
    return [
      {
        kind: side === "to" ? "expense" : "income",
        category: zen.labels[side][group],
        // Строки внутри группы — по счёту на той стороне, у долгов — по
        // человеку: счёт у всех долгов один.
        subcategory: group === "debts" ? t.payee || other || null : other || null,
        amount: t.amountBase,
        planGroup: true,
      },
    ];
  }

  if (t.kind === "transfer") {
    if (!scope.perimeterTransfers) return [];
    const out: BudgetHit[] = [];
    // Обе ноги берут сумму в БАЗОВОЙ валюте. У валютного перевода списание и
    // зачисление — разные числа в своих валютах, но в базовой это одна и та же
    // сумма; иначе перевод перестал бы гаситься и поехала бы «Разница».
    if (inside(t.outcomeAccount ? txOutKey(t) : undefined))
      out.push({
        kind: "expense",
        category: TRANSFER_CATEGORY,
        // Подкатегория — счёт НА ТОЙ СТОРОНЕ: в расходах видно, куда ушло, в
        // доходах — откуда пришло. Свой счёт и так известен из раздела.
        subcategory: t.incomeAccount ? label(txInKey(t), t.incomeAccount) : null,
        amount: t.amountBase,
        transfer: true,
      });
    if (inside(t.incomeAccount ? txInKey(t) : undefined))
      out.push({
        kind: "income",
        category: TRANSFER_CATEGORY,
        subcategory: t.outcomeAccount ? label(txOutKey(t), t.outcomeAccount) : null,
        amount: t.amountBase,
        transfer: true,
      });
    return out;
  }

  if (!inside(t.account ? txAccountKey(t) : undefined)) return [];
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
  if (zen && t.kind === "refund" && !zen.refunds)
    // «Баланс vs Расходы»: возврат из расходов не вычитается — это поступление
    // по той же категории.
    return [
      {
        kind: "income",
        category: t.category,
        subcategory: t.subcategory ?? null,
        amount: t.amountBase,
      },
    ];
  if (
    zen &&
    zen.refunds &&
    t.kind === "expense" &&
    zen.incomeOnly.has(categoryKey(t.category, t.subcategory))
  )
    // Трата в категории «только для доходов» — зеркальный возврат: Дзен-мани
    // вычитает её из дохода категории, а не заводит расход.
    return [
      {
        kind: "income",
        category: t.category,
        subcategory: t.subcategory ?? null,
        amount: -t.amountBase,
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
  ym?: string,
  monthStartDay: number = 1
): Transaction[] {
  // Месяц бюджета — отрезок дат, а не префикс «ГГГГ-ММ»: с первым днём 15
  // «2026-09» это 15.09–14.10. Иначе список за ячейкой показывал бы не те
  // операции, из которых сложилась её сумма.
  const range = ym ? periodRange(ym, monthStartDay) : null;
  return transactions.filter((t) => {
    if (range) {
      const day = (t.date || "").slice(0, 10);
      if (day < range.from || day > range.to) return false;
    }
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
  if (isAllAccounts(scope)) return transactions;
  return transactions.filter(
    (t) => t.kind !== "transfer" && !!t.account && inPerimeter(scope, txAccountKey(t))
  );
}
