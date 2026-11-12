import { afterEach, describe, expect, it, vi } from "vitest";
import { appErrors, clearAppErrors, formatAppErrors, hydrateSafely, installGlobalErrorHandlers, recordAppError } from "./appErrors";

const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});
afterEach(() => {
  clearAppErrors();
  vi.restoreAllMocks();
});

describe("журнал ошибок приложения", () => {
  it("хранит последние десять, новые первыми, текст обрезан", () => {
    quiet();
    for (let i = 0; i < 12; i++) recordAppError("тест", new Error(`ошибка ${i}`));
    recordAppError("тест", new Error("x".repeat(500)));
    expect(appErrors()).toHaveLength(10);
    expect(appErrors()[0].message).toHaveLength(300);
    expect(appErrors()[1].message).toBe("ошибка 11");
  });

  it("не Error — тоже пишется", () => {
    quiet();
    recordAppError("тест", "строка");
    expect(appErrors()[0]).toMatchObject({ name: "string", message: "строка", stack: null });
  });

  it("в отчёте — строка на ошибку; пусто — «нет»", () => {
    expect(formatAppErrors([])).toEqual(["Ошибки приложения: нет"]);
    quiet();
    recordAppError("загрузка «x»", new TypeError("сломалось"));
    const lines = formatAppErrors(appErrors());
    expect(lines[0]).toBe("Ошибки приложения (последние 1):");
    expect(lines[1]).toContain("загрузка «x» · TypeError: сломалось");
  });
});

describe("hydrateSafely — чтение хранилища", () => {
  const noSleep = async () => {};
  it("первая неудача — ещё попытка, без записи", async () => {
    let calls = 0;
    const ok = await hydrateSafely("x", async () => {
      if (++calls === 1) throw new Error("занято");
    }, { sleep: noSleep });
    expect(ok).toBe(true);
    expect(calls).toBe(2);
    expect(appErrors()).toHaveLength(0);
  });

  it("две неудачи — false и запись в журнал", async () => {
    quiet();
    const ok = await hydrateSafely("useDataStore", async () => {
      throw new Error("нет базы");
    }, { sleep: noSleep });
    expect(ok).toBe(false);
    expect(appErrors()[0]).toMatchObject({ source: "загрузка «useDataStore»", message: "нет базы" });
  });
});

describe("перехватчик окна", () => {
  it("ловит необработанное обещание и снимается", () => {
    quiet();
    const target = new EventTarget() as unknown as Window;
    const off = installGlobalErrorHandlers(target);
    const ev = new Event("unhandledrejection") as Event & { reason: unknown };
    ev.reason = new Error("потерялось");
    target.dispatchEvent(ev);
    expect(appErrors()[0]).toMatchObject({ source: "необработанное обещание", message: "потерялось" });
    off();
    target.dispatchEvent(ev);
    expect(appErrors()).toHaveLength(1);
  });
});
