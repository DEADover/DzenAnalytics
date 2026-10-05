/**
 * Подсказка тегов в комментарии после «#»: находит тег, даже если начало
 * набрано в другой раскладке — «#Jngecr» предлагает «#Отпуск».
 */
import { test, expect, connectZen } from "./harness";

test("тег в комментарии подсказывается и в неправильной раскладке", async ({ page }) => {
  await connectZen(page, "/transactions");
  const edit = page.getByRole("button", { name: "Редактировать операцию" });
  const dialog = page.getByRole("dialog");
  const comment = dialog.locator("textarea").first();

  // Заводим тег: комментарий «#Отпуск» у одной операции.
  await edit.first().click();
  await comment.fill("#Отпуск поездка");
  await dialog.getByRole("button", { name: "Сохранить" }).click();
  await expect(dialog).toBeHidden();

  // У другой операции набираем в английской раскладке.
  await edit.nth(2).click();
  await expect(dialog.getByRole("button", { name: "Сохранить" })).toBeInViewport();
  await page.waitForTimeout(400); // окно доехало: меню подсказки закрывается при прокрутке
  await comment.fill("");
  await comment.pressSequentially("#Jngecr");
  const option = page.locator("body > div button", { hasText: "Отпуск" }).last();
  await expect(option).toBeVisible();
  await comment.press("Enter");
  await expect(comment).toHaveValue("#Отпуск ");
});
