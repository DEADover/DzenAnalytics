import { describe, expect, it } from "vitest";
import { autoSyncDue, canSkipEmptySync, pushGate, settleFailure, syncSummary, PUSH_RECHECK_MS } from "./syncDecisions";
import { backoffMs, type SyncFailure } from "./syncDiagnostics";

const gate = (over: Partial<Parameters<typeof pushGate>[0]> = {}) =>
  pushGate({ want: "auto", mode: "auto", holdLeft: 0, pushStatus: "idle", pending: true, ...over });

describe("pushGate — когда автоматической отправке можно уходить", () => {
  it("всё готово — отправляем", () => {
    expect(gate()).toEqual({ action: "go" });
    expect(gate({ want: "on-sync", mode: "on-sync" })).toEqual({ action: "go" });
  });

  it("висит плашка «Отменить» — ждём, перепроверяя не реже чем раз в полсекунды", () => {
    expect(gate({ holdLeft: 200 })).toEqual({ action: "wait", ms: 200 });
    expect(gate({ holdLeft: 59_000 })).toEqual({ action: "wait", ms: PUSH_RECHECK_MS });
  });

  it("плашка держит даже тогда, когда отправлять уже нечего или режим сменили", () => {
    // Решать «бросить» рано: после «Отменить» правка может вернуться.
    expect(gate({ holdLeft: 100, pending: false }).action).toBe("wait");
    expect(gate({ holdLeft: 100, mode: "manual" }).action).toBe("wait");
  });

  it("режим сменили, пока ждали, — бросаем", () => {
    expect(gate({ mode: "manual" })).toEqual({ action: "drop" });
    expect(gate({ want: "on-sync", mode: "auto" })).toEqual({ action: "drop" });
  });

  it("идёт другая отправка — ждём её конца, а не бросаем", () => {
    expect(gate({ pushStatus: "syncing" })).toEqual({ action: "wait", ms: PUSH_RECHECK_MS });
  });

  it("всё, что ждало, отменили — отправлять нечего", () => {
    expect(gate({ pending: false })).toEqual({ action: "drop" });
  });
});

const failure = (streak: number, at: string): SyncFailure => ({
  at,
  kind: "pull",
  stage: "request",
  status: 500,
  code: null,
  name: "ZenApiError",
  message: "",
  stack: null,
  version: "test",
  streak,
});

describe("autoSyncDue — синхронизация по расписанию", () => {
  const NOW = new Date("2026-11-12T12:00:00Z").getTime();
  const base = {
    token: "t",
    enabled: true,
    status: "ok" as const,
    intervalMs: 15 * 60_000,
    lastSyncAt: "2026-11-12T11:00:00Z",
    pullFailure: null,
  };

  it("интервал прошёл — пора", () => {
    expect(autoSyncDue(base, NOW)).toBe(true);
    expect(autoSyncDue({ ...base, lastSyncAt: null }, NOW)).toBe(true);
  });

  it("не пора: нет токена, расписание выключено, идёт синхронизация, интервал не вышел", () => {
    expect(autoSyncDue({ ...base, token: null }, NOW)).toBe(false);
    expect(autoSyncDue({ ...base, enabled: false }, NOW)).toBe(false);
    expect(autoSyncDue({ ...base, status: "syncing" }, NOW)).toBe(false);
    expect(autoSyncDue({ ...base, status: "checking" }, NOW)).toBe(false);
    expect(autoSyncDue({ ...base, lastSyncAt: "2026-11-12T11:50:00Z" }, NOW)).toBe(false);
  });

  it("после ошибок ждёт паузу, а не повторяет каждые полминуты", () => {
    const at = new Date(NOW - 30_000).toISOString();
    expect(autoSyncDue({ ...base, pullFailure: failure(3, at) }, NOW)).toBe(false);
    expect(autoSyncDue({ ...base, pullFailure: failure(3, at) }, NOW - 30_000 + backoffMs(3))).toBe(true);
    // Серия закончилась (streak 0) — запись ошибки расписанию не мешает.
    expect(autoSyncDue({ ...base, pullFailure: failure(0, at) }, NOW)).toBe(true);
  });
});

describe("canSkipEmptySync — пустой ответ облака", () => {
  const ok = { hasCache: true, backfill: 0, diffEmpty: true, haveTransactions: true };
  it("всё есть и ничего не пришло — заканчиваем сразу", () => {
    expect(canSkipEmptySync(ok)).toBe(true);
  });
  it("иначе — полный путь", () => {
    expect(canSkipEmptySync({ ...ok, hasCache: false })).toBe(false);
    expect(canSkipEmptySync({ ...ok, backfill: 1 })).toBe(false);
    expect(canSkipEmptySync({ ...ok, diffEmpty: false })).toBe(false);
    // Лента пуста (например, после очистки) — её надо собрать из кэша.
    expect(canSkipEmptySync({ ...ok, haveTransactions: false })).toBe(false);
  });
});

describe("журнал и серия ошибок", () => {
  it("строка журнала", () => {
    const fmt = (n: number) => String(n);
    expect(syncSummary(true, 5, 1, fmt)).toBe("Загружено заново");
    expect(syncSummary(false, 0, 0, fmt)).toBe("Без изменений");
    expect(syncSummary(false, 3, 0, fmt)).toBe("+3 новых/изменённых");
    expect(syncSummary(false, 0, 2, fmt)).toBe("+0 новых/изменённых, 2 удалено");
  });

  it("удачная синхронизация обнуляет серию, но запись оставляет", () => {
    const f = failure(4, "2026-11-12T10:00:00Z");
    expect(settleFailure(f)).toEqual({ ...f, streak: 0 });
    const settled = { ...f, streak: 0 };
    expect(settleFailure(settled)).toBe(settled);
    expect(settleFailure(null)).toBeNull();
  });
});
