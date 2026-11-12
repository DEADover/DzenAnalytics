/**
 * Решения синхронизации и отправки — отдельно от самих запросов.
 *
 * Стор Дзен-мани делает сеть, базу и журнал; что делать дальше — ждать,
 * отправлять, пропускать — решают эти функции. Так их можно проверить
 * тестом без браузера, а два места, которые решают одно и то же (таймер
 * «Авто» и отправка «При синхронизации»), не расходятся.
 */

import type { PushMode, SyncStatus } from "../store/useZenmoneyStore";
import { nextAutoRetryAt, type SyncFailure } from "./syncDiagnostics";

/** Как часто перепроверять, пока отправку что-то держит, мс. */
export const PUSH_RECHECK_MS = 500;

export type PushGate = { action: "go" } | { action: "drop" } | { action: "wait"; ms: number };

/**
 * Можно ли автоматической отправке уходить прямо сейчас.
 *
 * - Висит плашка «Отменить» — ждём: отменённое не должно успеть уйти в
 *   облако. Проверяем часто — плашку могут закрыть раньше.
 * - Режим сменили, пока ждали, — отправку бросаем.
 * - Идёт другая отправка — ждём её конца: правка, сделанная по ходу, в тот
 *   запрос не попала.
 * - Всё, что ждало, отменили, — отправлять нечего.
 */
export function pushGate(a: {
  /** Режим, ради которого отправка запланирована. */
  want: PushMode;
  mode: PushMode;
  holdLeft: number;
  pushStatus: SyncStatus;
  pending: boolean;
}): PushGate {
  if (a.holdLeft > 0) return { action: "wait", ms: Math.min(a.holdLeft, PUSH_RECHECK_MS) };
  if (a.mode !== a.want) return { action: "drop" };
  if (a.pushStatus === "syncing") return { action: "wait", ms: PUSH_RECHECK_MS };
  if (!a.pending) return { action: "drop" };
  return { action: "go" };
}

/**
 * Пора ли синхронизации по расписанию. Не пора — без токена, при выключенном
 * расписании, во время идущей синхронизации, раньше интервала и во время
 * паузы после ошибок (1 → 2 → 5 → 15 → 30 мин).
 */
export function autoSyncDue(
  s: {
    token: string | null;
    enabled: boolean;
    status: SyncStatus;
    intervalMs: number;
    lastSyncAt: string | null;
    pullFailure: SyncFailure | null;
  },
  now: number
): boolean {
  if (!s.token || !s.enabled) return false;
  if (s.status === "syncing" || s.status === "checking") return false;
  const lastMs = s.lastSyncAt ? new Date(s.lastSyncAt).getTime() : 0;
  if (now - lastMs < s.intervalMs) return false;
  const retryAt = nextAutoRetryAt(s.pullFailure);
  return retryAt === null || now >= retryAt;
}

/**
 * Можно ли закончить синхронизацию сразу: облако ничего не прислало, а у нас
 * уже всё есть. Нельзя без кэша (первый заход или полная), при дозапросе по
 * новой версии схемы и пока лента пуста — её ещё надо собрать из кэша.
 */
export function canSkipEmptySync(a: {
  hasCache: boolean;
  backfill: number;
  diffEmpty: boolean;
  haveTransactions: boolean;
}): boolean {
  return a.hasCache && a.backfill === 0 && a.diffEmpty && a.haveTransactions;
}

/** Строка журнала об удачной синхронизации. */
export function syncSummary(isFull: boolean, changed: number, deleted: number, fmt: (n: number) => string): string {
  if (isFull) return "Загружено заново";
  if (changed === 0 && deleted === 0) return "Без изменений";
  return `+${fmt(changed)} новых/изменённых${deleted > 0 ? `, ${fmt(deleted)} удалено` : ""}`;
}

/** Удачная синхронизация обнуляет серию ошибок, саму запись оставляет. */
export function settleFailure(prev: SyncFailure | null): SyncFailure | null {
  return prev && prev.streak > 0 ? { ...prev, streak: 0 } : prev;
}
