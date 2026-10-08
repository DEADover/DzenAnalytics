import type { Transaction } from "../types";
import type { RuleAction, RuleCondition, RuleConditionGroup, RuleKindValue } from "./ruleEngine";
import { displayPayee } from "./format";
import { NO_CATEGORY, isServiceCategory } from "./zenmoneyMap";

/**
 * «Создать правило» из окна операции: черновик правила по её образцу.
 *
 * Условия — всё, по чему такие операции узнаются, через «И»: получатель
 * «равно», комментарий «содержит», счёт, тип операции и сумма «равно». Пустые
 * поля условий не дают. Лишнее человек удалит одной кнопкой, а дописывать
 * недостающее руками дольше. Действие — категория этой
 * операции: чаще всего правило заводят именно затем, чтобы похожие операции сами
 * получали ту же категорию. Человек дальше правит черновик в обычном редакторе.
 */
export interface RulePrefill {
  groups: RuleConditionGroup[];
  actions: RuleAction[];
}

export interface RuleSource extends Pick<Transaction, "payee" | "brand" | "comment" | "categoryFull" | "account"> {
  /** Тип в терминах правил: долг отдельно от перевода (`ruleKindOf`). */
  kind: RuleKindValue;
  /** Сумма в валюте отчётов без знака — так её сравнивает условие. */
  amountBase: number | null;
}

export function ruleDraftFromTransaction(t: RuleSource): RulePrefill {
  const payee = displayPayee(t).trim();
  const comment = (t.comment ?? "").trim();
  const account = (t.account ?? "").trim();
  const amount = t.amountBase != null && Number.isFinite(t.amountBase) ? Math.round(Math.abs(t.amountBase) * 100) / 100 : null;
  const conditions: RuleCondition[] = [];
  if (payee) conditions.push({ field: "payee", op: "equals", value: payee, caseInsensitive: true });
  if (comment) conditions.push({ field: "comment", op: "contains", value: comment, caseInsensitive: true });
  if (account) conditions.push({ field: "account", op: "equals", value: account, caseInsensitive: true });
  conditions.push({ field: "kind", op: "equals", value: t.kind, caseInsensitive: true });
  if (amount) conditions.push({ field: "amount", op: "equals", value: String(amount), caseInsensitive: false });
  const category = (t.categoryFull ?? "").trim();
  // «Перевод», «Долг» и «Без категории» — не категории, записать их правило не
  // сможет; тогда действие остаётся пустым, категорию выберет человек.
  const usable = category && category !== NO_CATEGORY && !isServiceCategory(category) ? category : "";
  return {
    groups: [{ join: "and", conditions }],
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
