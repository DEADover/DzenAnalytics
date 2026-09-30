/**
 * Объединение нескольких операций в одну — обратное разделению.
 *
 * Типичный случай — округления Т-Банка в «Инвесткопилку»: за неделю набегает
 * два десятка операций по 7–40 ₽, которые никто не хочет видеть по
 * отдельности. Их выделяют и схлопывают в одну.
 *
 * В Дзен-мани «склеить» нечего: у операции одна сумма, связи между
 * операциями нет. Поэтому объединение — это новая операция на общую сумму и
 * удаление исходных (они уходят в «Удалённые», откуда их можно вернуть; и
 * сохраняют банковские номера — по ним Дзен-мани узнаёт покупки и не заводит
 * их заново из выписки, как и при разделении).
 *
 * Здесь — только проверки и арифметика: можно ли объединить выбранное, какой
 * будет сумма и вид итоговой операции, что подставить в поля по умолчанию.
 */

import type { Transaction, TxKind } from "../types";

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Почему выбранное нельзя объединить, или `null`, если можно.
 *
 * Объединяем только то, что складывается в одну операцию без выдумки:
 * - всё на одном счёте (у перевода — одна и та же пара счетов): сумма с
 *   разных счетов в одной операции поменяла бы остатки счетов;
 * - переводы только с переводами: у перевода две ноги, у расхода одна;
 * - итог не ноль: операции на ноль в Дзен-мани не бывает.
 */
export function mergeProblem(txs: Transaction[]): string | null {
  if (txs.length < 2) return "Выберите хотя бы две операции";
  const transfers = txs.filter((t) => t.kind === "transfer").length;
  if (transfers > 0 && transfers < txs.length) {
    return "Переводы объединяются только с переводами";
  }
  if (transfers > 0) {
    const first = txs[0];
    const same = txs.every(
      (t) => t.outcomeAccount === first.outcomeAccount && t.incomeAccount === first.incomeAccount
    );
    if (!same) return "Объединить можно только переводы между одними и теми же счетами";
    return null;
  }
  const first = txs[0];
  if (!txs.every((t) => t.account === first.account)) {
    return "Объединить можно только операции одного счёта";
  }
  if (!txs.every((t) => t.currency === first.currency)) {
    return "Объединить можно только операции в одной валюте";
  }
  if (mergedTotal(txs).amount === 0) return "Операции в сумме дают ноль";
  return null;
}

/** Сумма со знаком: поступление — плюс, трата — минус. */
function signed(t: Transaction): number {
  return t.kind === "expense" ? -Math.abs(t.amount) : Math.abs(t.amount);
}

/**
 * Итог объединения: сумма (всегда положительная) и вид операции.
 *
 * Расходы и поступления складываются со знаками: покупка на 1 000 и возврат
 * на 200 — это расход на 800. Если в плюсе — доход, а если в выборке не было
 * ни одного дохода, только возвраты, то возврат: иначе возврат из магазина
 * превратился бы в «доход» и попал в доходы месяца.
 *
 * У переводов складываются обе ноги отдельно: в переводе между валютами
 * списание и зачисление в разных деньгах.
 */
export function mergedTotal(txs: Transaction[]): {
  kind: TxKind;
  amount: number;
  /** Зачисление — только у перевода. */
  incomeAmount?: number;
} {
  if (txs.length > 0 && txs.every((t) => t.kind === "transfer")) {
    return {
      kind: "transfer",
      amount: r2(txs.reduce((s, t) => s + Math.abs(t.outcomeAmount), 0)),
      incomeAmount: r2(txs.reduce((s, t) => s + Math.abs(t.incomeAmount), 0)),
    };
  }
  const net = r2(txs.reduce((s, t) => s + signed(t), 0));
  if (net < 0) return { kind: "expense", amount: -net };
  const kind: TxKind = txs.some((t) => t.kind === "income") ? "income" : "refund";
  return { kind, amount: net };
}

/**
 * Что встречается чаще — с весом по сумме: из двадцати округлений по «Инвестициям»
 * и одного по «Прочему» выбираем «Инвестиции». При равенстве — первое по порядку.
 */
function heaviest<T>(txs: Transaction[], key: (t: Transaction) => T | null): T | null {
  const weight = new Map<T, number>();
  for (const t of txs) {
    const k = key(t);
    if (k === null) continue;
    weight.set(k, (weight.get(k) ?? 0) + Math.abs(t.amount));
  }
  let best: T | null = null;
  let bestW = -1;
  for (const [k, w] of weight) {
    if (w > bestW) {
      best = k;
      bestW = w;
    }
  }
  return best;
}

export interface MergeDefaults {
  /** Самая поздняя дата выбранных: за неделю округлений это конец недели. */
  date: string;
  category: string;
  subcategory: string | null;
  payee: string;
  /** Разные комментарии — через «; », одинаковые — один раз. */
  comment: string;
  /** Вторые категории всех выбранных — чтобы метка «Отпуск» не потерялась. */
  extraCategories: string[];
}

/** Поля итоговой операции по умолчанию — человек может их поменять. */
export function mergeDefaults(txs: Transaction[]): MergeDefaults {
  const date = txs.reduce((max, t) => (t.date > max ? t.date : max), txs[0]?.date ?? "");
  const cat = heaviest(txs, (t) =>
    t.kind === "transfer" || !t.category ? null : `${t.category}\u0000${t.subcategory ?? ""}`
  );
  const [category = "", sub = ""] = cat ? cat.split("\u0000") : [];
  const payee = heaviest(txs, (t) => t.brand || t.payee || null) ?? "";
  const comments: string[] = [];
  for (const t of txs) {
    const c = t.comment.trim();
    if (c && !comments.includes(c)) comments.push(c);
  }
  const extras: string[] = [];
  for (const t of txs) {
    for (const e of t.extraCategories ?? []) if (!extras.includes(e)) extras.push(e);
  }
  return {
    date,
    category,
    subcategory: sub || null,
    payee,
    comment: comments.join("; "),
    extraCategories: extras,
  };
}
