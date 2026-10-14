/**
 * «Проверить и применить» и правило «Авто · Только новые» (#121): историю такое
 * правило не трогает, поэтому и окно не предлагает переписать старые операции.
 */
import { test, expect, connectZen } from "./harness";

test("«Авто · Только новые» не видит старых операций, «По кнопке» — видит", async ({ page }) => {
  await connectZen(page, "/rules");
  const id = await page.evaluate(async () => {
    type S = { getState: () => { addMany: (r: unknown[]) => Promise<string[]>; hydrate: () => Promise<void>; loaded: boolean } };
    const store = (window as unknown as { __store: (n: string) => Promise<Record<string, S>> }).__store;
    const { useCategoryRulesStore } = await store("useCategoryRulesStore");
    if (!useCategoryRulesStore.getState().loaded) await useCategoryRulesStore.getState().hydrate();
    const [id] = await useCategoryRulesStore.getState().addMany([
      {
        enabled: true,
        autoApply: true,
        title: "Пятёрочка — пометка",
        join: "and",
        conditions: [{ field: "payee", op: "equals", value: "Пятёрочка", caseInsensitive: true }],
        actions: [{ kind: "prependComment", value: "[магазин]" }],
      },
    ]);
    return id;
  });
  const check = page.getByRole("button", { name: /Проверить и применить/ }).first();
  const dialog = page.getByRole("dialog", { name: "Что изменят правила" });

  // Правило создано «сегодня», все операции старше — в окне их нет, и окно объясняет почему.
  await check.click();
  await expect(dialog).toContainText("Совпадений: 0");
  await expect(dialog).toContainText("«Авто · Только новые» историю не трогают");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // То же правило «По кнопке» проходит по всей истории.
  await page.evaluate(async (ruleId) => {
    type S = { getState: () => { update: (id: string, p: unknown) => Promise<void> } };
    const store = (window as unknown as { __store: (n: string) => Promise<Record<string, S>> }).__store;
    const { useCategoryRulesStore } = await store("useCategoryRulesStore");
    await useCategoryRulesStore.getState().update(ruleId, { autoApply: false });
  }, id);
  await check.click();
  await expect(dialog).not.toContainText("Совпадений: 0");
  await expect(dialog).not.toContainText("«Авто · Только новые»");
});
