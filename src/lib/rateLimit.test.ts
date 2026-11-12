import { describe, expect, it } from "vitest";
import { parseRetryAfter, ZenApiError } from "./zenmoney";
import { RATE_LIMIT_DEFAULT_MS, retryDelayFor, retryTransient } from "./zenRetry";
import { backoffMs, describeFailure, nextAutoRetryAt } from "./syncDiagnostics";

describe("Retry-After — сколько просит подождать Дзен-мани", () => {
  const now = Date.parse("2026-11-12T12:00:00Z");
  it("секунды и дата", () => {
    expect(parseRetryAfter("120", now)).toBe(120_000);
    expect(parseRetryAfter("Thu, 12 Nov 2026 12:00:30 GMT", now)).toBe(30_000);
  });
  it("нет, мусор или прошедшая дата — не знаем", () => {
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter("скоро", now)).toBeNull();
    expect(parseRetryAfter("Thu, 12 Nov 2026 11:00:00 GMT", now)).toBeNull();
  });
});

describe("пауза перед повтором", () => {
  it("429 — сколько просили, без заголовка — полминуты, а не полторы секунды", () => {
    expect(retryDelayFor(new ZenApiError("x", 429, null, 20_000), 1500)).toBe(20_000);
    expect(retryDelayFor(new ZenApiError("x", 429), 1500)).toBe(RATE_LIMIT_DEFAULT_MS);
  });
  it("просят дольше минуты — здесь не ждём", () => {
    expect(retryDelayFor(new ZenApiError("x", 429, null, 5 * 60_000), 1500)).toBeNull();
  });
  it("5xx — по плану; ошибка запроса — не повторять", () => {
    expect(retryDelayFor(new ZenApiError("x", 502), 1500)).toBe(1500);
    expect(retryDelayFor(new ZenApiError("x", 400), 1500)).toBeNull();
  });
  it("retryTransient ждёт столько, сколько просил сервер", async () => {
    const slept: number[] = [];
    let calls = 0;
    const r = await retryTransient(
      async () => {
        if (++calls === 1) throw new ZenApiError("x", 429, null, 7000);
        return "ok";
      },
      { sleep: async (ms) => void slept.push(ms) }
    );
    expect(r).toBe("ok");
    expect(slept).toEqual([7000]);
  });
});

describe("синхронизация по расписанию после 429", () => {
  const ctx = { kind: "pull" as const, stage: "request" as const, streak: 1, version: "t", now: new Date("2026-11-12T12:00:00Z") };
  it("ждёт не меньше, чем просил сервер", () => {
    const f = describeFailure(new ZenApiError("x", 429, null, 10 * 60_000), ctx);
    expect(f.retryAfterMs).toBe(10 * 60_000);
    expect(nextAutoRetryAt(f)).toBe(ctx.now.getTime() + 10 * 60_000);
  });
  it("просил меньше паузы — обычная пауза", () => {
    const f = describeFailure(new ZenApiError("x", 429, null, 1000), ctx);
    expect(nextAutoRetryAt(f)).toBe(ctx.now.getTime() + backoffMs(1));
  });
});
