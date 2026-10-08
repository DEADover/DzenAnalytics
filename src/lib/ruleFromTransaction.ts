import type { Transaction } from "../types";
import type { RuleAction, RuleConditionGroup } from "./ruleEngine";
import { displayPayee } from "./format";
import { NO_CATEGORY, isServiceCategory } from "./zenmoneyMap";

/**
 * «Создать правило» из окна операции: черновик правила по её образцу.
 *
 * Условие — то, по чему такие операции узнаются: получатель «равно», а у
 * операций без получателя — комментарий «содержит». Действие — категория этой
 * операции: чаще всего правило заводят именно затем, чтобы похожие операции сами
 * получали ту же категорию. Человек дальше правит черновик в обычном редакторе.
 */
export interface RulePrefill {
  groups: RuleConditionGroup[];
  actions: RuleAction[];
}

export function ruleDraftFromTransaction(
  t: Pick<Transaction, "payee" | "brand" | "comment" | "categoryFull">
): RulePrefill {
  const payee = displayPayee(t).trim();
  const comment = (t.comment ?? "").trim();
  const condition = payee
    ? { field: "payee" as const, op: "equals" as const, value: payee, caseInsensitive: true }
    : { field: "comment" as const, op: "contains" as const, value: comment, caseInsensitive: true };
  const category = (t.categoryFull ?? "").trim();
  // «Перевод», «Долг» и «Без категории» — не категории, записать их правило не
  // сможет; тогда действие остаётся пустым, категорию выберет человек.
  const usable = category && category !== NO_CATEGORY && !isServiceCategory(category) ? category : "";
  return {
    groups: [{ join: "and", conditions: [condition] }],
    actions: [{ kind: "setCategory", value: usable }],
  };
}

/**
 * Передача черновика из окна операции на страницу «Правил». Окно закрывается,
 * страница открывается и показывает черновик один раз — после перезагрузки его
 * уже нет, и это правильно: открытый «с прошлого раза» редактор только мешал бы.
 */
let pending: RulePrefill | null = null;

export function setPendingRulePrefill(p: RulePrefill): void {
  pending = p;
}

/** Черновик, если он ждёт. Не забирает: в StrictMode инициализатор состояния
 *  зовётся дважды, и второй вызов остался бы ни с чем. */
export function peekPendingRulePrefill(): RulePrefill | null {
  return pending;
}

/** Забыть черновик — страница его уже показала. */
export function clearPendingRulePrefill(): void {
  pending = null;
}
