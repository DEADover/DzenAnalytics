/**
 * Время операции — всегда в 24-часовом виде (#137): поле своё, а не родное
 * браузерное, которое на английской системе показывает «AM/PM».
 */
import { test, expect, connectZen, setPushMode } from "./harness";

test("время в окне операции — 24 часа, двоеточие встаёт само", async ({ page }) => {
  await connectZen(page, "/transactions");
  await setPushMode(page, "manual");

  const row = page.locator("div.grid", { hasText: "Кофейня у дома" }).filter({ hasText: "832" }).first();
  await row.getByRole("button", { name: "Изменить операцию" }).click();
  const card = page.getByRole("dialog");
  const time = card.getByLabel("Время", { exact: true });
  await expect(time).toBeVisible();
  // Родного поля времени в окне нет вовсе.
  await expect(card.locator('input[type="time"]')).toHaveCount(0);
  await expect(time).toHaveValue(/^([01]\d|2[0-3]):[0-5]\d$/);

  // Клик выделяет время целиком — набранное его заменяет.
  await time.click();
  await page.keyboard.type("1745");
  await expect(time).toHaveValue("17:45");
  if (process.env.E2E_SHOTS) await card.screenshot({ path: process.env.E2E_SHOTS + "/time-field.png" });
  // Час из одной цифры — с нулём.
  await time.press("ControlOrMeta+a");
  await page.keyboard.type("930");
  await expect(time).toHaveValue("09:30");
  // Стрелки: у минут — минуты, у часов — часы.
  await time.press("ArrowUp");
  await expect(time).toHaveValue("09:31");
  await time.press("Home");
  await time.press("ArrowDown");
  await expect(time).toHaveValue("08:31");
  // Недописанное при выходе из поля дополняется.
  await time.press("ControlOrMeta+a");
  await page.keyboard.type("7");
  await time.blur();
  await expect(time).toHaveValue("07:00");
});
