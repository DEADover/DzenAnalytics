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
