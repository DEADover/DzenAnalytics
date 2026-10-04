import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchDiff, ZenTimeoutError, ZEN_BODY_TIMEOUT_MS, ZEN_HEADERS_TIMEOUT_MS } from "./zenmoney";

/**
 * Тайм-ауты запросов к Дзен-мани. Без них зависший запрос (обрыв посреди
 * ответа, VPN, фильтр) держал синхронизацию «в процессе» до перезагрузки
 * страницы: кнопки неактивны, ошибки нет.
 */

/** Промис, который отклоняется только при отмене запроса. */
const untilAbort = (signal: AbortSignal) =>
  new Promise<never>((_, reject) =>
    signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
  );

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("запрос к Дзен-мани", () => {
  it("сервер молчит — обрыв через 60 с с понятной ошибкой", async () => {
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => untilAbort(init.signal!));
    const p = fetchDiff("t", 0);
    const check = expect(p).rejects.toThrow(ZenTimeoutError);
    await vi.advanceTimersByTimeAsync(ZEN_HEADERS_TIMEOUT_MS);
    await check;
  });

  it("ответ пришёл, а тело не докачивается — обрыв через 5 мин, не раньше", async () => {
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => ({
      ok: true,
      status: 200,
      json: () => untilAbort(init.signal!),
    }));
    const p = fetchDiff("t", 0);
    let settled = false;
    p.catch(() => {}).finally(() => (settled = true));
    // Длинное тело — не повод рвать на 60-й секунде.
    await vi.advanceTimersByTimeAsync(ZEN_HEADERS_TIMEOUT_MS + 1000);
    expect(settled).toBe(false);
    const check = expect(p).rejects.toMatchObject({ name: "ZenTimeoutError", phase: "body" });
    await vi.advanceTimersByTimeAsync(ZEN_BODY_TIMEOUT_MS);
    await check;
  });

  it("отмена вызывающим — это не тайм-аут", async () => {
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => untilAbort(init.signal!));
    const ctrl = new AbortController();
    const p = fetchDiff("t", 0, ctrl.signal);
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });

  it("обычный ответ проходит, таймеры не остаются висеть", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: true, status: 200, json: async () => ({ serverTimestamp: 5 }) }));
    await expect(fetchDiff("t", 0)).resolves.toEqual({ serverTimestamp: 5 });
    expect(vi.getTimerCount()).toBe(0);
  });
});
