/**
 * Операции, удалённые в Дзен-мани, — список для раздела «Удалённые».
 *
 * Дзен-мани не стирает удалённую операцию: она остаётся на сервере с
 * `deleted: true` и приходит к нам и при полной синхронизации, и в
 * инкрементальном ответе. Разбор (`mapZenmoneyDiff`) такие строки
 * отбрасывает, поэтому в расчётах их нет, — а в кэше они лежат целиком, со
 * всеми полями. Отсюда и берётся список.
 *
 * Три источника сводятся в один:
 *   1. Строки кэша с `deleted: true` — удалённые где угодно: в приложении
 *      Дзен-мани, на сайте, у нас.
 *   2. Наши удаления, которые кэш уже выбросил. Отправив удаление, мы сразу
 *      вычёркиваем строку из кэша (`applyDiff` с нашим `deletion`), а пометка
 *      `deleted: true` придёт только при следующей полной синхронизации.
 *      Данные берём из снимка, сделанного в момент удаления
 *      (`useDeletedPayloadsStore`).
 *   3. Наши удаления, ещё не отправленные: строка в кэше живая, но у нас
 *      спрятана (`useDeletedStore`).
 *
 * Не показываем операции, которые мы сами пересоздали под новым номером:
 * смену времени (Дзен-мани не меняет `created` на месте) и уже возвращённые
 * копии. Такую пару узнаём по детерминированному номеру копии
 * (`resurrectionId`): если копия есть в кэше — живая или тоже удалённая, —
 * оригинал больше не нужен.
 *
 * Модуль без React и без хранилищ — чистая функция, проверяется тестами.
 */
import type { ZenTransaction } from "./zenmoney";
import type { ZenCache } from "./zenmoneyCache";
import { resurrectionId } from "./zenmoneyPush";

/**
 * - `deleted` — удалена в Дзен-мани;
 * - `restore-pending` — человек вернул её у нас, копия ещё не отправлена;
 * - `delete-pending` — удалена у нас, удаление ещё не отправлено.
 */
export type DeletedStatus = "deleted" | "restore-pending" | "delete-pending";

export interface DeletedEntry {
  id: string;
  /** Строка для разбора — всегда с `deleted: false`, иначе разбор её пропустит. */
  zen: ZenTransaction;
  /** Когда удалена, мс. `null` — наше удаление, сделанное до того, как мы начали записывать время. */
  deletedAt: number | null;
  status: DeletedStatus;
  /**
   * В Дзен-мани есть живая операция с той же датой, суммами, счетами и
   * получателем. Обычно это убранный дубль — вернуть его значит снова
   * задвоить.
   */
  hasTwin: boolean;
}

/** Ключ «та же операция»: дата, суммы, счета и получатель без регистра. */
export function twinKey(t: ZenTransaction): string {
  return [
    t.date,
    t.income,
    t.outcome,
    t.incomeAccount,
    t.outcomeAccount,
    (t.payee ?? "").trim().toLowerCase(),
  ].join("|");
}

export function collectDeletedOperations({
  cache,
  payloads,
  deletedIds,
  deletedAt,
}: {
  cache: ZenCache;
  /** Снимки операций, удалённых у нас (и тех, что человек вернул). */
  payloads: Record<string, ZenTransaction>;
  /** Спрятанные у нас операции. */
  deletedIds: readonly string[];
  /** Когда мы их спрятали, мс. */
  deletedAt: Record<string, number>;
}): DeletedEntry[] {
  const hidden = new Set(deletedIds);
  const live = new Map<string, ZenTransaction>();
  const tombs = new Map<string, ZenTransaction>();
  // Живые операции по ключу двойника. Спрятанные у нас не считаются: их уже
  // удалили, и двойником убранной операции они быть не могут.
  const twins = new Map<string, string[]>();
  for (const t of cache.transactions) {
    const id = String(t.id);
    if (t.deleted) {
      tombs.set(id, t);
      continue;
    }
    live.set(id, t);
    if (hidden.has(id)) continue;
    const key = twinKey(t);
    const list = twins.get(key);
    if (list) list.push(id);
    else twins.set(key, [id]);
  }

  const out = new Map<string, DeletedEntry>();
  const add = (id: string, zen: ZenTransaction, status: DeletedStatus, at: number | null) => {
    if (out.has(id)) return;
    const copy = resurrectionId(id);
    if (live.has(copy) || tombs.has(copy)) return;
    out.set(id, {
      id,
      zen: { ...zen, deleted: false },
      deletedAt: at,
      status,
      hasTwin: (twins.get(twinKey(zen)) ?? []).some((other) => other !== id),
    });
  };

  // 1. Удалены в Дзен-мани. `changed` удалённой строки — время удаления.
  for (const [id, t] of tombs) {
    const restoring = id in payloads && !hidden.has(id);
    add(id, t, restoring ? "restore-pending" : "deleted", t.changed ? t.changed * 1000 : null);
  }
  // 2–3. Удалены у нас: ещё не отправлено — строка живая; отправлено — кэш
  // её уже выбросил, берём снимок.
  for (const id of deletedIds) {
    if (tombs.has(id)) continue;
    const row = live.get(id);
    if (row) add(id, row, "delete-pending", deletedAt[id] ?? null);
    else if (payloads[id]) add(id, payloads[id], "deleted", deletedAt[id] ?? null);
  }
  // Возвращены у нас после отправленного удаления — копия ещё не ушла.
  for (const [id, p] of Object.entries(payloads)) {
    if (hidden.has(id) || live.has(id) || tombs.has(id)) continue;
    add(id, p, "restore-pending", deletedAt[id] ?? null);
  }

  return [...out.values()].sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
}
