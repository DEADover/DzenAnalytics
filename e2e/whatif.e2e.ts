/**
 * «Что если»: событие с уже заполненной суммой. Кнопки выбора месяца стоят
 * внутри формы события и раньше её отправляли — окно правки закрывалось
 * вместо того, чтобы открыть календарь или шагнуть на месяц (issue #118).
 */
import { test, expect, connectZen } from "./harness";

// Календарь месяца закрывается при прокрутке — нужно окно, где он помещается целиком.
test.use({ viewport: { width: 1440, height: 900 } });

test("правка события: календарь месяца и стрелки не закрывают окно", async ({ page }) => {
  await connectZen(page, "/whatif");
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ has: page.locator("#whatif-event-amount") });
  await dialog.locator("#whatif-event-amount").fill("50000");
  await dialog.getByRole("button", { name: "Добавить", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole("button", { name: "Изменить событие" }).click();
  await expect(dialog).toBeVisible();
  const month = dialog.getByRole("button", { name: /Ноябрь 26 г\./ });

  // Стрелка шагает на месяц, окно остаётся.
  await month.locator("xpath=following-sibling::button[1]").click();
  await expect(dialog.getByRole("button", { name: /Декабрь 26 г\./ })).toBeVisible();

  // Подпись месяца открывает календарь, окно остаётся.
  await dialog.getByRole("button", { name: /Декабрь 26 г\./ }).click();
  await expect(page.locator("#whatif-event-amount")).toBeVisible();
  await page.getByRole("button", { name: "Ноя", exact: true }).click();
  await expect(dialog.getByRole("button", { name: /Ноябрь 26 г\./ })).toBeVisible();

  await dialog.getByRole("button", { name: "Сохранить" }).click();
  await expect(dialog).toHaveCount(0);
});
