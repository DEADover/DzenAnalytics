/**
 * Подписи к облачным снимкам.
 *
 * Строка под датой раньше выглядела так: «7 660 оп. · 32 счёт. · 48 тег. ·
 * 137 вал. · 7250 КБ». Сокращения экономили место ценой понятности, а «тег» —
 * ещё и слово из чужого словаря: по всему сервису это категория. Плюс «32
 * счёт.» не склонялось вовсе.
 *
 * Здесь всё пишется целиком и в правильном падеже, а объём — в тех единицах,
 * в которых его читают: мегабайты, когда счёт пошёл на мегабайты.
 */

import { formatNum } from "./format";
import { pluralRu } from "./plural";

/** Счётчики снимка — ровно те поля, что нужны подписи. */
export interface SnapshotCounts {
  transactions: number;
  accounts: number;
  tags: number;
  instruments: number;
}

/**
 * Объём по-человечески: килобайты до мегабайта, дальше мегабайты с десятой.
 *
 * «7250 КБ» — число, которое надо делить в уме; «7,1 МБ» читается сразу.
 */
export function formatBytes(bytes: number): string {
  const kb = bytes / 1024;
  if (kb < 1024) return `${formatNum(Math.round(kb))} КБ`;
  return `${formatNum(kb / 1024, { fractionDigits: 1 })} МБ`;
}

/**
 * Содержимое снимка одной строкой.
 *
 * Валюты показываем только если их больше одной: строка «137 валют» полезна
 * мультивалютному пользователю и ничего не сообщает всем остальным, а место
 * занимает.
 */
export function snapshotSummary(counts: SnapshotCounts, bytes: number): string {
  const parts = [
    `${formatNum(counts.transactions)} ${pluralRu(counts.transactions, ["операция", "операции", "операций"])}`,
    `${formatNum(counts.accounts)} ${pluralRu(counts.accounts, ["счёт", "счёта", "счетов"])}`,
    `${formatNum(counts.tags)} ${pluralRu(counts.tags, ["категория", "категории", "категорий"])}`,
  ];
  if (counts.instruments > 1) {
    parts.push(
      `${formatNum(counts.instruments)} ${pluralRu(counts.instruments, ["валюта", "валюты", "валют"])}`
    );
  }
  parts.push(formatBytes(bytes));
  return parts.join(" · ");
}
