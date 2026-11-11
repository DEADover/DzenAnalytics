import { describe, expect, it } from "vitest";
import { ZenApiError, ZenTimeoutError } from "./zenmoney";
import { isTransientZenError, retryTransient } from "./zenRetry";

const noSleep = async () => {};

describe("повтор запроса при временном сбое", () => {
  it("временные сбои: обрыв сети, тайм-аут, 429 и 5xx; ошибки запроса — нет", () => {
    expect(isTransientZenError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isTransientZenError(new ZenTimeoutError("headers", 60_000))).toBe(true);
    expect(isTransientZenError(new ZenApiError("Too many", 429))).toBe(true);
    expect(isTransientZenError(new ZenApiError("Bad gateway", 502))).toBe(true);
    expect(isTransientZenError(new ZenApiError("Bad request", 400))).toBe(false);
    expect(isTransientZenError(new ZenApiError("Unauthorized", 401))).toBe(false);
    expect(isTransientZenError(new Error("что-то своё"))).toBe(false);
  });

  it("после заминки повторяет и отдаёт результат", async () => {
    let calls = 0;
    const retries: number[] = [];
    const out = await retryTransient(
      async () => {
        calls += 1;
        if (calls < 3) throw new TypeError("Failed to fetch");
        return "ok";
      },
      { sleep: noSleep, onRetry: (n) => retries.push(n) }
    );
    expect(out).toBe("ok");
    expect(calls).toBe(3);
    expect(retries).toEqual([1, 2]);
  });

  it("сбой не проходит — после последней попытки ошибка доходит до вызвавшего", async () => {
    let calls = 0;
    await expect(
      retryTransient(
        async () => {
          calls += 1;
          throw new ZenApiError("Bad gateway", 502);
        },
        { sleep: noSleep }
      )
    ).rejects.toThrow("Bad gateway");
    expect(calls).toBe(3);
  });

  it("ошибку самого запроса не повторяет", async () => {
    let calls = 0;
    await expect(
      retryTransient(
        async () => {
          calls += 1;
          throw new ZenApiError("Bad request", 400);
        },
        { sleep: noSleep }
      )
    ).rejects.toThrow("Bad request");
    expect(calls).toBe(1);
  });
});
