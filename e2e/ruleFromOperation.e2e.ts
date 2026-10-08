/**
 * «Создать правило» в окне операции: «Правила» открываются с черновиком по
 * образцу операции — получатель «равно», комментарий «содержит» и её категория.
 */
import { test, expect, connectZen } from "./harness";

test("правило из операции: редактор открыт и заполнен", async ({ page }) => {
  await connectZen(page, "/transactions");
  const row = page
    .getByText("Ресторан", { exact: true })
    .first()
    .locator("xpath=ancestor::*[.//button[@aria-label='Редактировать операцию']][1]");
  await row.hover();
  await row.getByRole("button", { name: "Редактировать операцию" }).click();
  const op = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Создать правило" }) });
  await op.getByRole("button", { name: "Создать правило" }).click();

  await expect(page).toHaveURL(/\/rules$/);
  const editor = page.getByRole("dialog");
  await expect(editor).toBeVisible();
  await expect(editor.locator('input[value="Ресторан"]').first()).toBeVisible();
  // Комментарий операции — вторым условием через «И».
  await expect(editor.locator('input[value="День рождения"]').first()).toBeVisible();
  await expect(editor.getByText("Еда вне дома").first()).toBeVisible();

  // Закрыли — обычное «Новое правило» уже пустое, черновик не прилипает.
  await editor.getByRole("button", { name: "Отмена" }).click();
  await expect(editor).toHaveCount(0);
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(editor.locator('input[value="Ресторан"]')).toHaveCount(0);
});
