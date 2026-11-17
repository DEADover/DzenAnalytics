/**
 * Кнопка темы в шапке перебирает три режима: светлая → тёмная → авто.
 * «Авто» следует за оформлением ОС и меняется вместе с ним.
 */
import { test, expect, connectZen } from "./harness";

test("кнопка темы: светлая → тёмная → авто, «Авто» идёт за ОС", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page, "/");
  const btn = page.locator("button[data-theme-mode]");
  const html = page.locator("html");
  const isDark = () => html.evaluate((el) => el.classList.contains("dark") || el.dataset.theme === "dark");

  // Привести к светлой: сколько кликов — зависит от сохранённого режима.
  for (let i = 0; i < 3 && (await btn.getAttribute("data-theme-mode")) !== "light"; i++) await btn.click();
  await expect(btn).toHaveAttribute("data-theme-mode", "light");
  expect(await isDark()).toBe(false);

  await btn.click();
  await expect(btn).toHaveAttribute("data-theme-mode", "dark");
  await expect.poll(isDark).toBe(true);

  await btn.click();
  await expect(btn).toHaveAttribute("data-theme-mode", "auto");
  await expect(btn).toHaveAttribute("aria-label", /Авто, сейчас тёмная/);
  await expect.poll(isDark).toBe(true);

  // ОС переключилась на светлую — сервис следом, режим остаётся «Авто».
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(isDark).toBe(false);
  await expect(btn).toHaveAttribute("aria-label", /Авто, сейчас светлая/);

  await btn.click();
  await expect(btn).toHaveAttribute("data-theme-mode", "light");
});
