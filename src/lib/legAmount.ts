import type { Transaction } from "../types";

/**
 * Сколько ПРИШЛО на счёт зачисления, в базовой валюте.
 *
 * `amountBase` у перевода — сумма СПИСАНИЯ. Обычно она совпадает с зачислением,
 * но не всегда: при выдаче кредита банк удерживает страховку и комиссию, и с
 * кредитного счёта списано 358 575 ₽, а на карту пришло 200 000 ₽. Дзен-мани
 * в поступлениях считает то, что пришло (сверено: «Деньги на месяц» расходились
 * ровно на эти удержания, 261 544 ₽ на трёх кредитах).
 *
 * В одной валюте — доля суммы списания; между валютами в базовой это та же
 * сумма (курсовую разницу Дзен-мани в поступления не пишет).
 */
export function incomeLegBase(t: Transaction): number {
  if (t.kind !== "transfer") return t.amountBase;
  const out = t.outcomeAmount;
  const inc = t.incomeAmount;
  if (!(out > 0) || !(inc > 0)) return t.amountBase;
  if (t.incomeCurrency && t.incomeCurrency === t.outcomeCurrency) return t.amountBase * (inc / out);
  return t.amountBase;
}
