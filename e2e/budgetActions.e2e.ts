/**
 * Действия бюджета — у того, к чему относятся: «Заполнить план» в шапках
 * разделов «Поступления» / «Расходы» (окно открывается на своём разделе),
 * «Экспорт» — над годовой таблицей. В шапке страницы их нет.
 */
import { test, expect, connectZen } from "./harness";

test("«Заполнить план» — в шапке раздела, окно на своём разделе; «Экспорт» — над годовой таблицей", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connectZen(page, "/budgets");
  await page.getByRole("button", { name: "Месяц", exact: true }).first().click();
  const main = page.locator("main");
  // В шапке страницы кнопок больше нет.
  await expect(page.getByRole("button", { name: /^Заполнить план$/ })).toHaveCount(2);

  const incomeHead = main.locator("h2", { hasText: /^(Поступления|Деньги на месяц)$/ }).locator("xpath=..");
  await incomeHead.getByRole("button", { name: "Заполнить план" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const text = await dialog.innerText();
  const inc = text.search(/Поступления/i);
  const exp = text.search(/Расходы/i);
  expect(inc).toBeGreaterThanOrEqual(0);
  expect(exp).toBeGreaterThan(inc);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Год", exact: true }).first().click();
  await expect(main.getByText("Бюджет на 2026 год", { exact: true })).toBeVisible();
  await main.getByRole("button", { name: /Экспорт/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
