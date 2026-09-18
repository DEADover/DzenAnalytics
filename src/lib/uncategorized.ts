/**
 * «Без категории» — чистая часть: порядок ленты, разбивка по дням и учёт
 * подсказок.
 *
 * Раздел про одно действие: разметить операции, у которых категории нет. Всё
 * остальное — способы добраться до нужных: отсортировать, сгруппировать по
 * дням, отобрать те, где подсказка совпала явно, чтобы применить её пачкой.
 */

import type { Transaction } from "../types";
import type { CategorySuggestion } from "./aggregations";

export type UncategorizedSort =
  | "date-desc"
  | "date-asc"
  | "amount-desc"
  | "amount-asc"
  | "payee-asc"
  | "confidence-desc";

/** Порог, с которого совпадение считается явным и подсказку предлагают пачкой. */
export const CONFIDENT = 0.7;

export interface UncategorizedDay {
  key: string;
  ymd: string;
  txs: Transaction[];
}

/**
 * Порядок ленты.
 *
 * «По подсказке» ставит вперёд самые уверенные: с них разметку и начинают, а
 * операции, по которым подсказать нечего, уходят в конец — их придётся
 * разбирать руками.
 */
export function sortUncategorized(
  txs: readonly Transaction[],
  mode: UncategorizedSort,
  confidence?: (tx: Transaction) => number
): Transaction[] {
  const out = [...txs];
  switch (mode) {
    case "date-asc":
      return out.sort((a, b) => a.date.localeCompare(b.date));
    case "amount-desc":
      return out.sort((a, b) => Math.abs(b.amountBase) - Math.abs(a.amountBase));
    case "amount-asc":
      return out.sort((a, b) => Math.abs(a.amountBase) - Math.abs(b.amountBase));
    case "payee-asc":
      return out.sort((a, b) => (a.payee || "").localeCompare(b.payee || "", "ru"));
    case "confidence-desc":
      return out.sort(
        (a, b) =>
          (confidence?.(b) ?? 0) - (confidence?.(a) ?? 0) || b.date.localeCompare(a.date)
      );
    default:
      return out.sort((a, b) => b.date.localeCompare(a.date));
  }
}

/**
 * Разбивка по дням — только когда лента идёт по дате. При сортировке по сумме
 * или по подсказке дни перемешаны, и заголовок дня врал бы: под ним оказалась
 * бы одна строка из этого дня, а следующая — уже из другого.
 */
export function groupUncategorizedByDay(
  txs: readonly Transaction[],
  mode: UncategorizedSort
): UncategorizedDay[] | null {
  if (mode !== "date-desc" && mode !== "date-asc") return null;
  const days = new Map<string, UncategorizedDay>();
  for (const tx of txs) {
    const ymd = tx.date.slice(0, 10);
    let day = days.get(ymd);
    if (!day) {
      day = { key: ymd || "unknown", ymd, txs: [] };
      days.set(ymd, day);
    }
    day.txs.push(tx);
  }
  return [...days.values()];
}

/** Подсказки по id операции — лента достаёт их построчно. */
export function suggestionsById(
  suggestions: readonly CategorySuggestion[]
): Map<string, CategorySuggestion> {
  return new Map(suggestions.map((s) => [s.txId, s]));
}

/**
 * Можно ли применить подсказку: правило создаётся по получателю, а если его
 * нет — по комментарию. Не за что зацепиться — применять нечего.
 */
export function suggestionKey(
  s: Pick<CategorySuggestion, "payee" | "comment">
): { field: "payee" | "comment"; value: string } | null {
  const payee = (s.payee || "").trim();
  if (payee) return { field: "payee", value: payee };
  const comment = (s.comment || "").trim();
  if (comment) return { field: "comment", value: comment };
  return null;
}

/**
 * Откуда взялась подсказка — текст для подсказки при наведении.
 *
 * Прежде строка выглядела «Похоже на: Самокат, Самокат, Самокат»: имена
 * повторялись, а «похоже на» ничего не объясняло. Человеку нужно одно — по
 * каким его же операциям выбрана категория и сколько их было.
 */
export function suggestionReason(s: {
  reasonExamples: readonly string[];
  matched?: number;
  suggested: string;
}): string {
  const names = s.reasonExamples.filter((x) => x.trim());
  const count = s.matched ?? names.length;
  // Число — в скобках, а не словами: «так размечена 1 похожая операция» и «так
  // размечены 3 похожих операции» требуют согласовывать ещё и глагол, а строка
  // собирается из кусков.
  const head = "«" + s.suggested + "» — так размечены похожие операции" + (count > 0 ? " (" + count + ")" : "");
  return names.length > 0 ? head + ": " + names.join(", ") : head;
}

export interface SuggestionStats {
  /** Всего подсказок, которые есть что применить. */
  applicable: number;
  /** Из них явные — совпадение не ниже порога. */
  confident: number;
}

export function suggestionStats(
  suggestions: readonly CategorySuggestion[],
  applied: ReadonlySet<string>
): SuggestionStats {
  let applicable = 0;
  let confident = 0;
  for (const s of suggestions) {
    if (applied.has(s.txId) || !suggestionKey(s)) continue;
    applicable += 1;
    if (s.confidence >= CONFIDENT) confident += 1;
  }
  return { applicable, confident };
}
