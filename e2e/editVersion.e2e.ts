/**
 * Правка в очереди и изменение того же поля с другого устройства: побеждает
 * последнее. Раньше старая правка отсюда молча перекрывала свежее изменение с
 * телефона — и потом уезжала обратно в облако.
 */
import type { Page } from "@playwright/test";
import { test, expect, connectZen, setPushMode } from "./harness";
import { NOW } from "./fixtures/zenAccount";

type Store = { getState: () => Record<string, unknown> };
type Win = { __store: (n: string) => Promise<Record<string, Store>> };

/** Первая операция с комментарием — её и правим. */
const pickTx = (page: Page) =>
  page.evaluate(async () => {
    const w = window as unknown as Win;
    const { useDataStore } = await w.__store("useDataStore");
    const raw = useDataStore.getState().transactionsRaw as { id: string; comment: string; payee: string }[];
    const t = raw.find((x) => x.comment && x.payee)!;
    return { id: t.id, comment: t.comment, payee: t.payee };
  });

const editHere = (page: Page, id: string, patch: Record<string, string>) =>
  page.evaluate(
    async ([id, patch]) => {
      const w = window as unknown as Win;
      const { useEditsStore } = await w.__store("useEditsStore");
      await (useEditsStore.getState().setEdit as (id: string, p: unknown) => Promise<void>)(id, patch);
      // Как интерфейс: после правки — пересборка ленты поверх правок.
      const { useDataStore } = await w.__store("useDataStore");
      await (useDataStore.getState().refresh as () => Promise<void>)();
    },
    [id, patch] as const
  );

const syncNow = (page: Page) =>
  page.evaluate(async () => {
    const w = window as unknown as Win;
    const { useZenmoneyStore } = await w.__store("useZenmoneyStore");
    await (useZenmoneyStore.getState().sync as () => Promise<unknown>)();
  });

const shown = (page: Page, id: string) =>
  page.evaluate(async (id) => {
    const w = window as unknown as Win;
    const { useDataStore } = await w.__store("useDataStore");
    const { useEditsStore } = await w.__store("useEditsStore");
    const t = (useDataStore.getState().transactions as { id: string; comment: string; payee: string }[]).find((x) => x.id === id)!;
    const edit = (useEditsStore.getState().edits as Record<string, Record<string, unknown>>)[id];
    return { comment: t.comment, payee: t.payee, edit: edit ?? null };
  }, id);

test.beforeEach(async ({ page }) => {
  await connectZen(page, "/transactions");
  await setPushMode(page, "manual");
});

test("поле поменяли в облаке позже — правка поля снимается, видно облачное", async ({ page, zen }) => {
  const t = await pickTx(page);
  await editHere(page, t.id, { comment: "Правка с компьютера" });
  expect((await shown(page, t.id)).comment).toBe("Правка с компьютера");

  zen.cloudEdits.push({ id: t.id, patch: { comment: "С телефона" } });
  await syncNow(page);
  const after = await shown(page, t.id);
  expect(after.comment).toBe("С телефона");
  expect(after.edit).toBeNull();
});

test("в облаке поменяли другое поле — своя правка остаётся", async ({ page, zen }) => {
  const t = await pickTx(page);
  await editHere(page, t.id, { comment: "Правка с компьютера" });
  zen.cloudEdits.push({ id: t.id, patch: { payee: "Новый получатель" } });
  await syncNow(page);
  const after = await shown(page, t.id);
  expect(after.comment).toBe("Правка с компьютера");
  expect(after.payee).toBe("Новый получатель");
  expect(after.edit).toEqual({ comment: "Правка с компьютера" });
});

test("облачное изменение старше правки — правка новее и остаётся", async ({ page, zen }) => {
  const t = await pickTx(page);
  await editHere(page, t.id, { comment: "Правка с компьютера" });
  zen.cloudEdits.push({ id: t.id, patch: { comment: "Давно с телефона", changed: Math.floor(NOW.getTime() / 1000) - 3600 } });
  await syncNow(page);
  expect((await shown(page, t.id)).comment).toBe("Правка с компьютера");
});
