/**
 * Отметки строк операций в лентах и шторке — для «Оформления» (#139): полоска
 * «новая» / «не отправлена» и время операции.
 */
import type { Transaction } from "../types";
import type { NewMarkStyle } from "../store/useDisplayStore";
import { isoToLocalTime } from "./buildEditPatch";

/**
 * Класс полоски «новая» / «не отправлена» для строки — когда в «Оформлении»
 * выбрана полоска или подсветка (`.row-mark-*` в index.css). При точке — ничего: отметку
 * рисует `OperationCategory`. Черновик важнее: у него пометки «новая» нет.
 */
export function operationMarkClass(style: NewMarkStyle, tx: Transaction, draft: boolean): string | undefined {
  if (style === "dot") return undefined;
  const mark = draft ? "row-mark-draft" : tx.unseen ? "row-mark-new" : null;
  if (!mark) return undefined;
  // «Подсветка» — та же полоска плюс лёгкая заливка всей строки (#139).
  return style === "fill" ? `${mark} row-mark-fill` : mark;
}

/**
 * Время операции «ЧЧ:ММ» по местному часовому поясу. У операций без времени
 * (из файла выписки, где его нет) — пусто: полночь по Гринвичу там значит
 * «время не задано», а не «03:00».
 */
export function operationTime(tx: Transaction): string {
  if (!tx.createdAt || tx.createdAt === `${tx.date}T00:00:00Z`) return "";
  return isoToLocalTime(tx.createdAt);
}
