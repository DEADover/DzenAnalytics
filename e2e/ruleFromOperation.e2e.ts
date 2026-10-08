/**
 * «Создать правило» в окне операции: «Правила» открываются с черновиком по
 * образцу операции — получатель, комментарий, счёт, тип и сумма через «И» и
 * её категория.
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
  // Условия — в том же порядке, что и список полей.
  await expect(editor.locator('[aria-label="Поле условия"]')).toHaveText([
    /Тип операции/,
    /Счёт/,
    /Текущая категория/,
    /Получатель/,
    /Комментарий/,
    /Сумма/,
  ]);
  // Счёт, тип и сумма — тоже условиями.
  await expect(editor.locator('input[value="9000"]').first()).toBeVisible();
  await expect(editor.getByText("Сбер").first()).toBeVisible();
  await expect(editor.getByText("Расход").first()).toBeVisible();
  await expect(editor.getByText("Еда вне дома").first()).toBeVisible();

  // Сумма «равно» → «от … до»: число становится нижней границей.
  await editor.locator('[aria-haspopup="listbox"][aria-label="Условие"]').last().click();
  await page.getByRole("option", { name: "от … до" }).click();
  await expect(editor.getByLabel("Сумма от")).toHaveValue("9000");
  await editor.getByLabel("Сумма до").fill("10 000");
  await expect(editor.getByText(/Сумма от 9000 до 10 000/).first()).toBeVisible();
  await expect(editor.getByText(/Подойд[её]т 1 операция/)).toBeVisible();

  // Закрыли — обычное «Новое правило» уже пустое, черновик не прилипает.
  await editor.getByRole("button", { name: "Отмена" }).click();
  await expect(editor).toHaveCount(0);
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(editor.locator('input[value="Ресторан"]')).toHaveCount(0);
});
