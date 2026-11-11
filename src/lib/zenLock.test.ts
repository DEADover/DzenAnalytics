import { describe, expect, it } from "vitest";
import { zenExclusive } from "./zenLock";

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("синхронизация и отправка по очереди", () => {
  it("второй шаг ждёт конца первого, даже если тот дольше", async () => {
    const log: string[] = [];
    const a = zenExclusive(async () => {
      log.push("a:start");
      await tick(20);
      log.push("a:end");
      return "a";
    });
    const b = zenExclusive(async () => {
      log.push("b:start");
      return "b";
    });
    expect(await Promise.all([a, b])).toEqual(["a", "b"]);
    expect(log).toEqual(["a:start", "a:end", "b:start"]);
  });

  it("сбой одного шага не останавливает очередь и доходит до вызвавшего", async () => {
    const failed = zenExclusive(async () => {
      throw new Error("сеть");
    });
    const next = zenExclusive(async () => "дальше");
    await expect(failed).rejects.toThrow("сеть");
    expect(await next).toBe("дальше");
  });
});
