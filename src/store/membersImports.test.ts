import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

/**
 * Раньше хранилище участников импортировало хранилища данных и Дзен-мани,
 * а те — его; при неудачном порядке
 * (например, шапка первой тянула хранилище операций) список полей облачных
 * настроек обращался к ещё не готовому хранилищу участников, и приложение
 * падало на старте. Теперь участники никого не импортируют — подписчики
 * приходят к ним сами (`onMembersVisibilityChange`).
 */
describe("хранилище участников не замыкает круг импортов", () => {
  it("не импортирует хранилища, которые импортируют его", () => {
    const src = readFileSync(fileURLToPath(new URL("./useMembersStore.ts", import.meta.url)), "utf8");
    // Только импорты значений: `import type` при сборке исчезает и порядок
    // загрузки не меняет.
    const valueImports = [...src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
    for (const banned of ["./useDataStore", "./useZenmoneyStore", "./useCloudSettingsStore", "./cloudSettingsFields"]) {
      expect(valueImports, `useMembersStore импортирует ${banned}`).not.toContain(banned);
    }
  });

  it("смена видимости зовёт подписчиков по порядку и ждёт их", async () => {
    vi.resetModules();
    const { onMembersVisibilityChange, useMembersStore } = await import("./useMembersStore");
    const calls: string[] = [];
    const offA = onMembersVisibilityChange(async () => {
      await new Promise((r) => setTimeout(r, 5));
      calls.push("refresh");
    }, 1);
    const offB = onMembersVisibilityChange(() => {
      calls.push("invalidate");
    }, 0);
    const db = await import("../lib/db");
    vi.spyOn(db, "saveJSON").mockResolvedValue(undefined);
    await useMembersStore.getState().setOwnerId(7);
    offA();
    offB();
    expect(calls.slice(-2)).toEqual(["invalidate", "refresh"]);
  });
});
