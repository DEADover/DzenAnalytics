/**
 * Таблица «Счета»: владелец и пометки — своими столбцами, а не чипами у
 * названия. «Владелец» есть только при совместном доступе: на личном
 * аккаунте у всех счетов он один.
 */
import { test, expect, connectZen } from "./harness";

const SPOUSE = 1002;

test("личный аккаунт: столбца «Владелец» нет", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connectZen(page, "/accounts");
  const head = page.locator("table.acc-table thead");
  await expect(head.getByText("Счёт", { exact: true })).toBeVisible();
  await expect(head.getByText("Владелец", { exact: true })).toHaveCount(0);
});

test("совместный доступ: «Владелец» столбцом, у счёта без владельца — «Общий»", async ({ page, zen }) => {
  zen.patchFull = (diff) => ({
    ...diff,
    user: [...diff.user, { ...diff.user[0], id: SPOUSE, login: "spouse" }],
    account: diff.account.map((a, i) => ({ ...a, role: i === 0 ? null : a.id === "acc-sber" ? SPOUSE : diff.user[0].id })),
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connectZen(page, "/accounts");
  const table = page.locator("table.acc-table");
  await expect(table.locator("thead").getByText("Владелец", { exact: true })).toBeVisible();
  await expect(table.locator("tbody").getByText("Общий", { exact: true }).first()).toBeVisible();
  await expect(table.locator("tbody").getByText("spouse", { exact: true }).first()).toBeVisible();
});

test("«Капитал»: счёт с нулём и без операций в списке; сброс фильтров не включает архив", async ({ page, zen }) => {
  zen.patchFull = (diff) => ({
    ...diff,
    account: [
      ...diff.account,
      { ...diff.account[0], id: "acc-empty", title: "Пустая карта", balance: 0, startBalance: 0, archive: false },
    ],
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connectZen(page, "/accounts");
  const table = page.locator("table.acc-table");
  await expect(table.getByText("Пустая карта", { exact: true })).toBeVisible();

  // Фильтры, под которые не подходит ни один счёт, → «Сбросить фильтры».
  await page.evaluate(async () => {
    type S = { getState: () => { patch: (p: Record<string, unknown>) => Promise<void> } };
    const store = (window as unknown as { __store: (n: string) => Promise<Record<string, S>> }).__store;
    const { useAccountsViewStore } = await store("useAccountsViewStore");
    await useAccountsViewStore.getState().patch({ balanceScope: "out", onlySavings: true, showArchived: false });
  });
  await page.getByRole("button", { name: "Сбросить фильтры" }).click();
  await expect(table.getByText("Пустая карта", { exact: true })).toBeVisible();
  const showArchived = await page.evaluate(async () => {
    type S = { getState: () => { showArchived: boolean } };
    const store = (window as unknown as { __store: (n: string) => Promise<Record<string, S>> }).__store;
    const { useAccountsViewStore } = await store("useAccountsViewStore");
    return useAccountsViewStore.getState().showArchived;
  });
  expect(showArchived).toBe(false);
});
