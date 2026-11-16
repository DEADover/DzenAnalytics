/**
 * Под открытой панелью «Ещё» страница не прокручивается: колесо над панелью
 * уводило фон, а сама панель оставалась висеть под шапкой.
 */
import { test, expect, connectZen } from "./harness";

test("страница под панелью «Ещё» стоит на месте и не прыгает вбок", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page, "/transactions");
  await expect(page.locator(".op-row").first()).toBeVisible();
  const scrollY = () => page.evaluate(() => window.scrollY);
  const mainLeft = () => page.evaluate(() => document.querySelector("main")!.getBoundingClientRect().left);
  const left = await mainLeft();

  await page.getByRole("button", { name: "Ещё" }).first().click();
  await expect(page.getByRole("button", { name: "Настроить основное меню" })).toBeVisible();
  // Фон не сдвинулся вбок из-за пропавшей полосы прокрутки.
  expect(await mainLeft()).toBe(left);
  await page.mouse.move(700, 300);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(200);
  expect(await scrollY()).toBe(0);

  // Закрыли — прокрутка вернулась.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Настроить основное меню" })).toHaveCount(0);
  await page.mouse.wheel(0, 600);
  await expect.poll(scrollY).toBeGreaterThan(0);
});
