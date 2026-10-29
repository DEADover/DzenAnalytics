/**
 * Подключение с первого экрана — на месте, окном с токеном, а не переходом в
 * настройки. Без входа через Дзен-мани (здесь он не настроен) — именно окно.
 */
import { test, expect, FAKE_TOKEN } from "./harness";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("первый экран: окно с токеном, данные загружаются, остаёмся на месте", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("С чего начнём?")).toBeVisible();
  await page.getByRole("button", { name: /Подключить Дзен-мани/ }).click();

  const dialog = page.getByRole("dialog", { name: "Подключить Дзен-мани" });
  await expect(dialog).toBeVisible();
  // Поле в фокусе сразу — токен вставляют, не целясь мышью.
  await expect(dialog.getByLabel("Токен Дзен-мани")).toBeFocused();
  if (process.env.E2E_SHOTS) {
    await page.waitForTimeout(400);
    await dialog.screenshot({ path: process.env.E2E_SHOTS + "/connect-dialog.png" });
  }
  await expect(dialog.getByRole("button", { name: "Подключить" })).toBeDisabled();
  await dialog.getByLabel("Токен Дзен-мани").fill(FAKE_TOKEN);
  await page.keyboard.press("Enter");

  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator("[data-toast]")).toContainText("Дзен-мани подключён");
  await expect(page.getByText("С чего начнём?")).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
});

test("непринятый токен — ошибка в самом окне, оно не закрывается", async ({ page, zen }) => {
  zen.rejected.add("bad-token");
  await page.goto("/");
  await page.getByRole("button", { name: /Подключить Дзен-мани/ }).click();
  const dialog = page.getByRole("dialog", { name: "Подключить Дзен-мани" });
  await dialog.getByLabel("Токен Дзен-мани").fill("bad-token");
  await dialog.getByRole("button", { name: "Подключить" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Дзен-мани не принял токен");
  await expect(dialog).toBeVisible();
});

test("из демо: «Подключить свой Дзен-мани» — после выхода то же окно", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Посмотреть демо/ }).click();
  const connect = page.getByRole("button", { name: "Подключить свой Дзен-мани" });
  await expect(connect).toBeVisible({ timeout: 15_000 });
  await connect.click();
  await expect(page.getByRole("dialog", { name: "Подключить Дзен-мани" })).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/$/);
});
