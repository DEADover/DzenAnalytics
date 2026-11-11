/**
 * Синхронизация, которой нечего принести, не пересобирает ленту, кэш и
 * калибровку: на большом аккаунте это секунды на каждый автозапуск.
 */
import type { Page } from "@playwright/test";
import { test, expect, connectZen } from "./harness";

type Win = { __store: (n: string) => Promise<Record<string, { getState: () => Record<string, unknown> }>>; __txBefore?: unknown };

const syncNow = (page: Page) =>
  page.evaluate(async () => {
    const w = window as unknown as Win;
    const { useZenmoneyStore } = await w.__store("useZenmoneyStore");
    const z = useZenmoneyStore.getState() as { sync: () => Promise<{ count: number }> };
    return (await z.sync()).count;
  });

const snapshot = (page: Page) =>
  page.evaluate(async () => {
    const w = window as unknown as Win;
    const { useDataStore } = await w.__store("useDataStore");
    const { useZenmoneyStore } = await w.__store("useZenmoneyStore");
    const tx = useDataStore.getState().transactions as { id: string }[];
    const z = useZenmoneyStore.getState() as { serverTimestamp: number | null; lastSyncAt: string | null };
    const same = w.__txBefore === tx;
    w.__txBefore = tx;
    return { same, count: tx.length, ids: tx.map((t) => t.id), stamp: z.serverTimestamp, lastSyncAt: z.lastSyncAt };
  });

test("пустой ответ — лента та же, метка сервера та же", async ({ page, zen }) => {
  await connectZen(page, "/transactions");
  const before = await snapshot(page);
  const pulls = zen.pulls;
  await page.waitForTimeout(20);
  const count = await syncNow(page);
  expect(zen.pulls).toBe(pulls + 1);
  const after = await snapshot(page);
  expect(after.same).toBe(true);
  expect(count).toBe(before.count);
  expect(after.stamp).toBe(before.stamp);
});

test("удаление в облаке — обычным путём: операция уходит из ленты", async ({ page, zen }) => {
  await connectZen(page, "/transactions");
  const before = await snapshot(page);
  const gone = before.ids[0]!;
  zen.cloudDeletes.push(gone);
  await syncNow(page);
  const after = await snapshot(page);
  expect(after.same).toBe(false);
  expect(after.ids).not.toContain(gone);
  expect(after.stamp).toBeGreaterThan(before.stamp ?? 0);
});
