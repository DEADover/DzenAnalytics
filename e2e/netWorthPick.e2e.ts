/**
 * «Совокупный баланс»: снятая галочка у одного счёта не добавляет в график
 * счета вне баланса. Раньше меню предлагало и их, и «все, кроме одного»
 * включало ипотеку вне баланса — линия уходила в минус на миллионы.
 */
import { test, expect, connectZen } from "./harness";

test("снять один счёт — линия без счетов вне баланса", async ({ page, zen }) => {
  zen.patchFull = (diff) => ({
    ...diff,
    account: [
      ...diff.account,
      { ...diff.account[0], id: "acc-mortgage", title: "Ипотека", type: "loan", inBalance: false, balance: -2_900_000, startBalance: -2_900_000 },
    ],
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connectZen(page, "/accounts");
  await page.getByRole("button", { name: "Совокупно" }).click();
  const card = page.locator(".card-tray", { has: page.getByText(/Активы минус долги на каждый день/) });
  const axis = card.locator(".recharts-yAxis");
  await expect(axis).toBeVisible();
  const before = (await axis.textContent()) ?? "";

  await card.getByRole("button", { name: /^Счета/ }).click();
  // Счёт вне баланса в меню не предлагается — он не входит и в «Все»:
  // пять счетов в балансе, ипотеки среди них нет.
  const head = page.getByText("5 счетов", { exact: true });
  await expect(head).toBeVisible();
  const menu = head.locator("xpath=../..");
  await expect(menu.getByText("Ипотека")).toHaveCount(0);
  await menu.getByText("Наличные", { exact: true }).last().click();
  await page.keyboard.press("Escape");
  await expect(card.getByRole("button", { name: /^Счета/ })).toContainText("из");
  // Наличных 6 500 ₽ — шкала почти не меняется и уж точно не уходит в минус.
  await expect(axis).not.toContainText("млн");
  expect(before).not.toContain("млн");
});

test("старый сохранённый выбор со счётом вне баланса — график его не считает", async ({ page, zen }) => {
  zen.patchFull = (diff) => ({
    ...diff,
    account: [
      ...diff.account,
      { ...diff.account[0], id: "acc-mortgage", title: "Ипотека", type: "loan", inBalance: false, balance: -2_900_000, startBalance: -2_900_000 },
    ],
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connectZen(page, "/accounts");
  await page.getByRole("button", { name: "Совокупно" }).click();
  await page.evaluate(async () => {
    type S = { getState: () => { patch: (p: Record<string, unknown>) => Promise<void> } };
    const store = (window as unknown as { __store: (n: string) => Promise<Record<string, S>> }).__store;
    const { useAccountsViewStore } = await store("useAccountsViewStore");
    await useAccountsViewStore.getState().patch({
      chartAccounts: ["acc-tbank", "acc-sber", "acc-save", "acc-usd", "acc-mortgage"],
    });
  });
  const card = page.locator(".card-tray", { has: page.getByText(/Активы минус долги на каждый день/) });
  // Ипотека из выбора отсечена: четыре счёта из пяти в балансе.
  await expect(card.getByRole("button", { name: /^Счета/ })).toContainText("4 из 5");
  // Шкала в тысячах: ипотеки на −2,9 млн в линии нет.
  await expect(card).toContainText("тыс.");
  await expect(card).not.toContainText("млн");
});
