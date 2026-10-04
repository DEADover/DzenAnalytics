import { describe, it, expect } from "vitest";
import {
  backoffMs,
  describeFailure,
  failureDetails,
  formatSyncReport,
  friendlyFailure,
  isAuthExpired,
  isFailureActive,
  nextAutoRetryAt,
  type SyncFailure,
  type SyncReportInput,
} from "./syncDiagnostics";
import { ZenApiError, ZenTimeoutError } from "./zenmoney";
import { mergeLogEntry, type SyncLogEntry } from "../store/useSyncLogStore";

const ctx = { kind: "pull" as const, stage: "request" as const, streak: 1, version: "9.9.9", now: new Date("2026-10-04T10:00:00Z") };

/**
 * Диагностика синхронизации: когда синхронизация ломается у отдельных людей,
 * по записи об ошибке должно быть видно, что случилось, — а автоповтор не
 * должен долбить сервер и затирать журнал.
 */
describe("запись об ошибке", () => {
  it("ответ сервера: статус и код сохраняются, 401 — про повторный вход", () => {
    const f = describeFailure(new ZenApiError("Unauthorized", 401, "auth"), ctx);
    expect(f).toMatchObject({ status: 401, code: "auth", name: "ZenApiError", stage: "request", version: "9.9.9" });
    expect(friendlyFailure(f)).toMatch(/Войдите заново/);
    expect(failureDetails(f)).toBe("Шаг: Запрос изменений у Дзен-мани · HTTP 401 (auth) · ZenApiError: Unauthorized · Версия 9.9.9");
  });

  it("обрыв сети — подсказка про интернет, VPN и блокировщик", () => {
    const f = describeFailure(new TypeError("Failed to fetch"), ctx);
    expect(f.status).toBeNull();
    expect(friendlyFailure(f)).toMatch(/VPN/);
  });

  it("тайм-аут — своим текстом", () => {
    const f = describeFailure(new ZenTimeoutError("headers", 60_000), ctx);
    expect(friendlyFailure(f)).toMatch(/не ответил за 60 с/);
  });

  it("ошибка разбора данных — с названием шага", () => {
    const f = describeFailure(new TypeError("Cannot read properties of undefined"), { ...ctx, stage: "apply" });
    expect(friendlyFailure(f)).toBe("Не удалось на шаге «Разбор операций и правил»: Cannot read properties of undefined");
    expect(f.stack?.split("\n").length).toBeLessThanOrEqual(6);
  });

  it("5xx и 429 — временное, повторим позже", () => {
    expect(friendlyFailure(describeFailure(new ZenApiError("x", 503), ctx))).toMatch(/временно/);
    expect(friendlyFailure(describeFailure(new ZenApiError("x", 429), ctx))).toMatch(/реже/);
  });

  it("не Error — тоже разбирается", () => {
    expect(describeFailure("строка", ctx).message).toBe("строка");
  });
});

describe("пауза автоповтора", () => {
  it("1 → 2 → 5 → 15 → 30 минут и дальше 30", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map((n) => backoffMs(n) / 60_000)).toEqual([0, 1, 2, 5, 15, 30, 30]);
  });

  it("следующая попытка — от времени ошибки; после удачи паузы нет", () => {
    const f: SyncFailure = describeFailure(new Error("x"), { ...ctx, streak: 3 });
    expect(nextAutoRetryAt(f)).toBe(new Date("2026-10-04T10:05:00Z").getTime());
    expect(nextAutoRetryAt({ ...f, streak: 0 })).toBeNull();
    expect(nextAutoRetryAt(null)).toBeNull();
  });
});

describe("активна ли ошибка", () => {
  const f401 = describeFailure(new ZenApiError("x", 401), ctx);
  it("пока серия не прервана удачей — активна", () => {
    expect(isFailureActive(f401)).toBe(true);
    expect(isFailureActive({ ...f401, streak: 0 })).toBe(false);
    expect(isFailureActive(null)).toBe(false);
  });
  it("токен не принимается, пока после 401 не было удачи", () => {
    expect(isAuthExpired(f401)).toBe(true);
    expect(isAuthExpired({ ...f401, streak: 0 })).toBe(false);
    expect(isAuthExpired(describeFailure(new ZenApiError("x", 500), ctx))).toBe(false);
  });
});

describe("журнал: та же ошибка подряд — одной строкой", () => {
  const err = (ts: number, error = "Сбой"): SyncLogEntry => ({ id: String(ts), ts, kind: "pull", status: "error", title: "Синхронизация", error });
  it("повтор увеличивает счётчик, а не добавляет строку", () => {
    let log = mergeLogEntry([], err(1), 100);
    log = mergeLogEntry(log, err(2), 100);
    log = mergeLogEntry(log, err(3), 100);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ repeat: 3, firstTs: 1, ts: 3 });
  });
  it("другая ошибка или удача — новая строка", () => {
    let log = mergeLogEntry([], err(1), 100);
    log = mergeLogEntry(log, err(2, "Другое"), 100);
    log = mergeLogEntry(log, { ...err(3), status: "ok", error: undefined }, 100);
    log = mergeLogEntry(log, err(4), 100);
    expect(log.map((e) => e.ts)).toEqual([4, 3, 2, 1]);
  });
  it("предел записей соблюдается", () => {
    let log: SyncLogEntry[] = [];
    for (let i = 0; i < 5; i++) log = mergeLogEntry(log, { ...err(i), status: "ok" }, 3);
    expect(log).toHaveLength(3);
  });
});

describe("отчёт", () => {
  const base: SyncReportInput = {
    version: "1.10.4",
    origin: "https://dzenanalytics.ru",
    userAgent: "Test/1.0",
    now: new Date("2026-10-04T10:00:00Z"),
    loginMethod: "oauth",
    pushMode: "Вручную",
    autoSync: "каждые 30 мин",
    cloudSettings: "выключен",
    lastSyncAt: "2026-10-01T10:00:00.000Z",
    serverTimestamp: 1_790_000_000,
    pullFailure: describeFailure(new ZenApiError("Unauthorized", 401), { ...ctx, streak: 4 }),
    pushFailure: null,
    cache: { transactions: 1234, accounts: 7, tags: 32, bytes: 3 * 1024 * 1024 },
    pending: { операции: 2, удаления: 0 },
    storage: { usage: 50 * 1024 * 1024, quota: 1024 * 1024 * 1024 },
    profiles: 2,
    log: [{ ts: 1, kind: "pull", status: "error", title: "Синхронизация", error: "Сбой", repeat: 5 }],
  };

  it("содержит главное: версию, вход, ошибку с шагом и статусом, размеры, очередь", () => {
    const text = formatSyncReport(base);
    expect(text).toContain("Версия: 1.10.4");
    expect(text).toContain("Вход: кнопкой «Войти через Дзен-мани»");
    expect(text).toContain("Последняя ошибка синхронизации:");
    expect(text).toContain("HTTP 401");
    expect(text).toContain("подряд: 4");
    expect(text).toContain("операций 1234, счетов 7, категорий 32, 3.0 МБ");
    expect(text).toContain("Очередь правок: операции 2");
    expect(text).toContain("Последняя ошибка отправки правок: нет");
    expect(text).toContain("×5");
  });

  it("прошедшая ошибка помечена, пустые разделы — словами", () => {
    const text = formatSyncReport({
      ...base,
      pullFailure: { ...base.pullFailure!, streak: 0 },
      cache: null,
      pending: {},
      storage: null,
      log: [],
    });
    expect(text).toContain("уже прошла");
    expect(text).toContain("Данные Дзен-мани в браузере: нет");
    expect(text).toContain("Очередь правок: пусто");
    expect(text).toContain("Место сайта в браузере: неизвестно");
  });
});
