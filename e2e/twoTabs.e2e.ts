/**
 * Панель открыта в двух вкладках: правка из одной не должна пропадать из-за
 * записи в другой. Вкладка узнаёт о чужой записи и перечитывает очередь.
 */
import type { Page } from "@playwright/test";
import { test, expect, connectZen, preparePage, setPushMode } from "./harness";

async function setEdit(page: Page, id: string, patch: Record<string, unknown>) {
  await page.evaluate(
    async ([txId, p]) => {
      type S = {
        useEditsStore: { getState: () => { setEdit: (id: string, p: unknown) => Promise<void> } };
        useDataStore: { getState: () => { refresh: () => Promise<void> } };
      };
      const store = (window as unknown as { __store: (n: string) => Promise<S> }).__store;
      await (await store("useEditsStore")).useEditsStore.getState().setEdit(txId as string, p);
      await (await store("useDataStore")).useDataStore.getState().refresh();
    },
    [id, patch] as const
  );
}

const editsIn = (page: Page) =>
  page.evaluate(async () => {
    type S = { useEditsStore: { getState: () => { edits: Record<string, { comment?: string }> } } };
    const { useEditsStore } = await (window as unknown as { __store: (n: string) => Promise<S> }).__store("useEditsStore");
    return useEditsStore.getState().edits;
  });

const commentIn = (page: Page, id: string) =>
  page.evaluate(async (txId) => {
    type S = { useDataStore: { getState: () => { transactions: { id: string; comment?: string | null }[] } } };
    const { useDataStore } = await (window as unknown as { __store: (n: string) => Promise<S> }).__store("useDataStore");
    return useDataStore.getState().transactions.find((t) => t.id === txId)?.comment;
  }, id);

test("две вкладки: правки из обеих остаются в очереди и видны в обеих", async ({ page, context }) => {
  await connectZen(page, "/transactions");
  await setPushMode(page, "manual");

  const second = await context.newPage();
  await preparePage(second);
  await second.goto("/transactions");
  await second.locator(".op-row").first().waitFor();

  // Правка в первой вкладке доезжает до второй — и до её ленты.
  await setEdit(page, "tx-0003", { comment: "из первой вкладки" });
  await expect.poll(async () => (await editsIn(second))["tx-0003"]?.comment).toBe("из первой вкладки");
  await expect.poll(() => commentIn(second, "tx-0003")).toBe("из первой вкладки");

  // Вторая вкладка правит другую операцию — и не затирает правку первой.
  await setEdit(second, "tx-0010", { comment: "из второй вкладки" });
  await expect.poll(async () => Object.keys(await editsIn(page)).sort()).toEqual(["tx-0003", "tx-0010"]);
  expect(Object.keys(await editsIn(second)).sort()).toEqual(["tx-0003", "tx-0010"]);
  await expect.poll(() => commentIn(page, "tx-0010")).toBe("из второй вкладки");
});

test("две вкладки: синхронизация в одной обновляет ленту в другой", async ({ page, context, zen }) => {
  await connectZen(page, "/transactions");
  const second = await context.newPage();
  await preparePage(second);
  await second.goto("/transactions");
  await second.locator(".op-row").first().waitFor();

  const count = (p: Page) =>
    p.evaluate(async () => {
      type S = { useDataStore: { getState: () => { transactions: unknown[] } } };
      const { useDataStore } = await (window as unknown as { __store: (n: string) => Promise<S> }).__store("useDataStore");
      return useDataStore.getState().transactions.length;
    });
  const before = await count(second);
  // Операцию удалили в Дзен-мани; синхронизируется только первая вкладка.
  zen.cloudDeletes = ["tx-0003"];
  await page.locator('button[title^="Синхронизация с Дзен-мани"]').click();
  await expect.poll(() => count(page)).toBe(before - 1);
  await expect.poll(() => count(second)).toBe(before - 1);
});
