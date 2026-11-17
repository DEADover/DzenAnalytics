/**
 * Подсказки правил: человек три раза руками меняет категорию у одного
 * контрагента — на «Правилах» появляется готовый черновик правила.
 */
import { test, expect, connectZen, setPushMode } from "./harness";

/** Сменить категорию у первых `count` операций контрагента — как руками в окне операции. */
async function fixCategory(page: import("@playwright/test").Page, payee: string, count: number, to: string) {
  await page.evaluate(
    async ({ payee, count, to }) => {
      type T = { id: string; payee: string };
      type Data = { getState: () => { transactions: T[] } };
      type Edits = { getState: () => { setEdit: (id: string, patch: unknown) => Promise<void> } };
      const store = (window as unknown as { __store: (n: string) => Promise<Record<string, unknown>> }).__store;
      const { useDataStore } = (await store("useDataStore")) as { useDataStore: Data };
      const { useEditsStore } = (await store("useEditsStore")) as { useEditsStore: Edits };
      const ids = useDataStore.getState().transactions.filter((t) => t.payee === payee).slice(0, count).map((t) => t.id);
      for (const id of ids) {
        await useEditsStore.getState().setEdit(id, { category: to, subcategory: null, categoryFull: to });
      }
    },
    { payee, count, to }
  );
}

test("три правки категории руками дают подсказку правила", async ({ page }) => {
  await connectZen(page, "/rules");
  await setPushMode(page, "manual");
  const card = page.locator("[data-rule-suggestions]");
  await expect(card).toHaveCount(0);

  // Двух правок мало.
  await fixCategory(page, "Яндекс Go", 2, "Дом");
  await expect(card).toHaveCount(0);
  await fixCategory(page, "Яндекс Go", 3, "Дом");
  await expect(card).toBeVisible();
  const row = card.locator("[data-rule-suggestion]");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Контрагент: Яндекс Go → Категория: Дом");
  await expect(row).toContainText("Исправляли вручную: 3 раза");
  await expect(row).toContainText(/· Сейчас у контрагента \d+ операци/);
  if (process.env.E2E_SHOTS) await card.screenshot({ path: process.env.E2E_SHOTS + "/rule-suggestions.png" });

  // «Создать правило» открывает редактор с готовым условием и действием.
  await row.getByRole("button", { name: "Создать правило" }).click();
  const editor = page.getByRole("dialog");
  await expect(editor.locator('input[value="Яндекс Go"]').first()).toBeVisible();
  await expect(editor.getByText("Дом").first()).toBeVisible();
  await editor.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(editor).toHaveCount(0);
  // Правило есть — подсказка больше не нужна.
  await expect(card).toHaveCount(0);
});

test("подсказку можно скрыть и вернуть «Отменить»; она переживает перезагрузку", async ({ page }) => {
  await connectZen(page, "/rules");
  await setPushMode(page, "manual");
  await fixCategory(page, "Кинопоиск", 3, "Дом");
  const card = page.locator("[data-rule-suggestions]");
  await expect(card).toBeVisible();

  // Журнал лежит на диске: после перезагрузки подсказка на месте.
  await page.reload();
  await expect(card).toBeVisible();

  await card.getByRole("button", { name: /^Не предлагать правило/ }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: "Отменить" }).click();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: /^Не предлагать правило/ }).click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Добавить", exact: true })).toBeVisible();
  await expect(card).toHaveCount(0);
});
