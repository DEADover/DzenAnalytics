/**
 * Подсказка в комментарии: серый хвост по прежним комментариям, Tab
 * принимает, Esc прячет и не закрывает окно.
 */
import { test, expect, connectZen } from "./harness";

test("комментарий: подсказка по прежним, Tab принимает, Esc прячет", async ({ page }) => {
  await connectZen(page, "/transactions");
  const row = page
    .getByText("Ресторан", { exact: true })
    .first()
    .locator("xpath=ancestor::*[.//button[@aria-label='Редактировать операцию']][1]");
  await row.hover();
  await row.getByRole("button", { name: "Редактировать операцию" }).click();
  const dialog = page.getByRole("dialog");
  const field = dialog.locator("textarea");
  const ghost = dialog.locator("[data-comment-ghost]");

  // «Аренда» встречается каждый месяц — её и дописываем.
  await field.fill("");
  await field.pressSequentially("Ар");
  await expect(ghost).toContainText("енда");
  await page.keyboard.press("Tab");
  await expect(field).toHaveValue("Аренда");
  await expect(ghost).toHaveCount(0);

  // Другая раскладка: «Fh» — это «Ар».
  await field.fill("");
  await field.pressSequentially("Fh");
  await expect(ghost).toContainText("→ Аренда");
  await page.keyboard.press("Tab");
  await expect(field).toHaveValue("Аренда");

  // Esc прячет подсказку, а окно остаётся.
  await field.fill("");
  await field.pressSequentially("Ар");
  await expect(ghost).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(ghost).toHaveCount(0);
  await expect(dialog).toBeVisible();

  // Без подсказки Tab ведёт дальше, а не вставляет что-то.
  await field.fill("Неповторимое");
  await page.keyboard.press("Tab");
  await expect(field).toHaveValue("Неповторимое");
});
