/**
 * Escape закрывает только верхний слой (lib/escapeStack): календарь в окне
 * операции — первым нажатием, окно — вторым. Список фильтра тоже
 * закрывается Escape.
 */
import { test, expect, connectZen } from "./harness";

test("календарь в окне операции: первый Escape — календарь, второй — окно", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page, "/transactions");
  await page.locator(".op-row").first().dblclick();
  const dialog = page.getByRole("dialog").filter({ hasText: "Редактирование операции" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Открыть календарь" }).click();
  const calendar = page.getByRole("dialog", { name: "Выбор даты" });
  await expect(calendar).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(calendar).toHaveCount(0);
  await expect(dialog).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("список счетов в фильтрах закрывается Escape", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page, "/transactions");
  await page.getByRole("button", { name: /^Счета/ }).first().click();
  const surface = page.locator("[data-popover-surface]");
  await expect(surface).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(surface).toHaveCount(0);
});

test("окно операции: Tab и Shift+Tab ходят по кругу внутри окна", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page, "/transactions");
  await page.locator(".op-row").first().dblclick();
  const dialog = page.getByRole("dialog").filter({ hasText: "Редактирование операции" });
  await expect(dialog).toBeVisible();
  const insideDialog = () =>
    page.evaluate(() => !!document.activeElement?.closest('[role="dialog"][aria-modal="true"]'));
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    expect(await insideDialog()).toBe(true);
  }
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await insideDialog()).toBe(true);
  }
});
