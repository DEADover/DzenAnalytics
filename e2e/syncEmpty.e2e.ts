/**
 * Синхронизация, которой нечего принести, не пересобирает ленту, кэш и
 * калибровку: на большом аккаунте это секунды на каждый автозапуск.
 */
import type { Page } from "@playwright/test";
import { test, expect, connectZen, setPushMode } from "./harness";

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

const commentOf = (page: Page, id: string) =>
  page.evaluate(async (txId) => {
    const w = window as unknown as Win;
    const { useDataStore } = await w.__store("useDataStore");
    const tx = useDataStore.getState().transactions as { id: string; comment?: string }[];
    return tx.find((t) => t.id === txId)?.comment ?? null;
  }, id);

test("отправка без правок забрала изменения облака — следующая синхронизация доносит их до ленты", async ({ page, zen }) => {
  await connectZen(page, "/transactions");
  const { ids } = await snapshot(page);
  const id = ids[0]!;
  await setPushMode(page, "manual");
  zen.cloudEdits.push({ id, patch: { comment: "Поправлено на телефоне" } });
  // Отправка сперва забирает свежие изменения облака (проверка конфликтов),
  // а слать ей нечего.
  await page.evaluate(async () => {
    const w = window as unknown as Win;
    const { useZenmoneyStore } = await w.__store("useZenmoneyStore");
    await (useZenmoneyStore.getState() as { pushPendingEdits: () => Promise<unknown> }).pushPendingEdits();
  });
  await syncNow(page);
  expect(await commentOf(page, id)).toBe("Поправлено на телефоне");
});

test("синхронизация оборвалась после записи кэша — следующая всё равно собирает ленту", async ({ page, zen }) => {
  await connectZen(page, "/transactions");
  const { ids } = await snapshot(page);
  const id = ids[0]!;
  zen.cloudEdits.push({ id, patch: { comment: "Пришло, пока вкладку закрывали" } });
  // Обрыв между записью кэша и сборкой ленты — как закрытая или
  // перезагруженная посреди синхронизации вкладка.
  const failed = await page.evaluate(async () => {
    const w = window as unknown as Win;
    const { useDataStore } = await w.__store("useDataStore");
    const { useZenmoneyStore } = await w.__store("useZenmoneyStore");
    const data = useDataStore.getState() as { setTransactions: unknown };
    const real = data.setTransactions;
    (useDataStore as unknown as { setState: (p: object) => void }).setState({
      setTransactions: () => Promise.reject(new Error("обрыв")),
    });
    try {
      await (useZenmoneyStore.getState() as { sync: () => Promise<unknown> }).sync();
      return false;
    } catch {
      return true;
    } finally {
      (useDataStore as unknown as { setState: (p: object) => void }).setState({ setTransactions: real });
    }
  });
  expect(failed).toBe(true);
  await syncNow(page);
  expect(await commentOf(page, id)).toBe("Пришло, пока вкладку закрывали");
});
