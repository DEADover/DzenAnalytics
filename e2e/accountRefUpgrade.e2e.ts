/**
 * Настройки прежних версий помнят счёт названием. Они переводятся на ключ счёта,
 * и переименование счёта в Дзен-мани его не отвязывает (#131).
 */
import { test, expect, connectZen, readMeta } from "./harness";

type Goal = { name: string; accountTitle?: string | null; accountTitles?: string[] | null };
type Win = { __store: (n: string) => Promise<Record<string, { getState: () => Record<string, (...a: unknown[]) => Promise<void>> }>> };

test("счёт цели переименовали — цель его не теряет", async ({ page, zen }) => {
  await connectZen(page, "/goals");
  await page.evaluate(async () => {
    const w = window as unknown as Win;
    const { useGoalsStore } = await w.__store("useGoalsStore");
    const { useFireStore } = await w.__store("useFireStore");
    // Как сохраняли прежние версии: счёт — названием.
    await useGoalsStore.getState().add({
      name: "Отпуск",
      target: 500_000,
      current: 0,
      deadline: null,
      accountTitle: "Накопительный счёт",
      accountTitles: ["Накопительный счёт"],
    });
    await useFireStore.getState().replaceExcluded(["Наличные"]);
  });

  // Название заменилось ключом — в цели и в счетах вне капитала FIRE.
  await expect.poll(async () => (await readMeta<Goal[]>(page, "goals"))?.[0]?.accountTitles).toEqual(["acc-save"]);
  await expect.poll(() => readMeta<string[]>(page, "fireExcludedAccounts")).toEqual(["acc-cash"]);

  // Счёт переименовали в Дзен-мани.
  zen.patchFull = (diff) => ({
    ...diff,
    account: diff.account.map((a) => (a.id === "acc-save" ? { ...a, title: "Копилка" } : a)),
  });
  await page.evaluate(async () => {
    const w = window as unknown as Win;
    const { useZenmoneyStore } = await w.__store("useZenmoneyStore");
    await useZenmoneyStore.getState().sync({ force: true });
  });

  const card = page.locator("main").filter({ hasText: "Отпуск" });
  await expect(card).toContainText("Копилка");
  await expect(card).not.toContainText("не найден");
  expect((await readMeta<Goal[]>(page, "goals"))?.[0]?.accountTitles).toEqual(["acc-save"]);
});

test("остальные настройки со счетами по названию переводятся на ключи", async ({ page }) => {
  await connectZen(page, "/");
  await page.evaluate(async () => {
    type S = { getState: () => Record<string, (...a: unknown[]) => Promise<unknown>> & { activeId: string } };
    const w = window as unknown as { __store: (n: string) => Promise<Record<string, S>> };
    const { useBudgetSettingsStore } = await w.__store("useBudgetSettingsStore");
    const { useSlicesStore } = await w.__store("useSlicesStore");
    const { useAccountsViewStore } = await w.__store("useAccountsViewStore");
    const { useSavedViewsStore } = await w.__store("useSavedViewsStore");
    await useBudgetSettingsStore.getState().update({ accounts: ["Сбер"] });
    await useSlicesStore.getState().setAccounts(useSlicesStore.getState().activeId, ["Наличные"]);
    await useAccountsViewStore.getState().patch({ chartAccounts: ["Т-Банк", "acc-usd"] });
    await useSavedViewsStore.getState().add({
      name: "Сбер",
      preset: "all",
      from: null,
      to: null,
      accounts: ["Сбер"],
      categories: [],
      currencies: [],
      search: "",
      excludeTransfers: false,
    });
  });

  await expect
    .poll(async () => (await readMeta<{ accounts: string[] }>(page, "budgetSettings"))?.accounts)
    .toEqual(["acc-sber"]);
  await expect
    .poll(async () => (await readMeta<{ slices: { excludedAccounts: string[] }[] }>(page, "dataSlices"))?.slices[0]?.excludedAccounts)
    .toEqual(["acc-cash"]);
  await expect
    .poll(async () => (await readMeta<{ chartAccounts: string[] }>(page, "accountsView"))?.chartAccounts)
    .toEqual(["acc-tbank", "acc-usd"]);
  await expect
    .poll(async () => (await readMeta<{ accounts: string[] }[]>(page, "savedViews"))?.[0]?.accounts)
    .toEqual(["acc-sber"]);
});
