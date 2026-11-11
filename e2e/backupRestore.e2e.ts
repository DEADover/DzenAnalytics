/**
 * Восстановление из бэкапа пишет операции и настройки ОДНОЙ транзакцией в
 * настоящую IndexedDB: либо всё, либо ничего. Модульные тесты круга бэкапа
 * работают с подменой хранилища и этого не видят.
 */
import { test, expect, connectZen } from "./harness";

test("бэкап: круг через настоящее хранилище возвращает операции, курсы и настройки", async ({ page }) => {
  await connectZen(page, "/transactions");
  const result = await page.evaluate(async () => {
    type Backup = {
      buildBackupPayload: () => Promise<unknown>;
      parseAndValidateBackup: (json: string) => Record<string, unknown>;
      restoreBackupPayload: (dump: Record<string, unknown>) => Promise<void>;
    };
    type Db = {
      loadTransactions: () => Promise<unknown[]>;
      clearTransactions: () => Promise<void>;
      loadRates: () => Promise<unknown>;
      loadJSON: (k: string) => Promise<unknown>;
      saveJSON: (k: string, v: unknown) => Promise<void>;
    };
    const backup = (await import(/* @vite-ignore */ "/src/lib/backup.ts")) as Backup;
    const db = (await import(/* @vite-ignore */ "/src/lib/db.ts")) as Db;

    await db.saveJSON("dataSlices", { slices: [{ id: "s1", name: "Личное", excludedCategories: ["Кафе"], excludedAccounts: [] }], activeId: "s1" });
    const before = (await db.loadTransactions()).length;
    const json = JSON.stringify(await backup.buildBackupPayload());

    // Портим всё, что бэкап должен вернуть.
    await db.clearTransactions();
    await db.saveJSON("dataSlices", null);
    await db.saveJSON("rates", null);

    await backup.restoreBackupPayload(backup.parseAndValidateBackup(json));
    return {
      before,
      after: (await db.loadTransactions()).length,
      rates: (await db.loadRates()) !== null,
      slices: await db.loadJSON("dataSlices"),
    };
  });
  expect(result.before).toBeGreaterThan(100);
  expect(result.after).toBe(result.before);
  expect(result.rates).toBe(true);
  expect(result.slices).toMatchObject({ activeId: "s1", slices: [{ name: "Личное", excludedCategories: ["Кафе"] }] });
});
