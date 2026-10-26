/**
 * Скользящие окна периода: ровно 30/90/180/365 дней, а стрелки — и у названия,
 * и у дат — листают само окно, не снимая выбор с его кнопки. Пресеты с
 * названием (отчётный месяц) стрелки у дат тоже листают своей единицей.
 * Часы e2e — 15.10.2026.
 */
import { test, expect, connectZen } from "./harness";
import type { Page } from "@playwright/test";

const pressed = (page: Page) => page.locator('[aria-pressed="true"]').first();
// Дорожка дат — по самим датам, стрелка — первая кнопка в ней. Не по
// подписи: под мышью её забирает мост подсказок (`nativeTooltips`), и поиск
// по ней перескакивал на другую стрелку.
const rangeTrack = (page: Page) =>
  page.locator("div.seg-track").filter({ hasText: /\d\d\.\d\d\.\d\d/ }).first();
const prevRange = (page: Page) => rangeTrack(page).locator("button").first();

test("«30 дней»: ровно тридцать дней и стрелки листают окнами", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connectZen(page, "/categories");
  // Кнопка окна подписана последним выбранным окном — по умолчанию «30 дней».
  await page.getByRole("group", { name: "Период" }).getByRole("button", { name: "30 дней", exact: true }).click();
  await expect(pressed(page)).toHaveText(/30 дней/);
  const track = rangeTrack(page);
  const first = await track.innerText();
  // Тридцать дней, включая последний: начало — за 29 дней до конца.
  const [from, to] = first.replace(/\s+/g, " ").match(/\d\d\.\d\d\.\d\d/g)!;
  const d = (s: string) => Date.UTC(2000 + +s.slice(6, 8), +s.slice(3, 5) - 1, +s.slice(0, 2));
  expect((d(to) - d(from)) / 86_400_000 + 1).toBe(30);

  await prevRange(page).click();
  await expect(pressed(page)).toHaveText(/30 дней/);
  await expect(track).not.toHaveText(first);
  const [from2, to2] = (await track.innerText()).replace(/\s+/g, " ").match(/\d\d\.\d\d\.\d\d/g)!;
  // Предыдущее окно кончается накануне начала текущего.
  expect((d(from) - d(to2)) / 86_400_000).toBe(1);
  expect((d(to2) - d(from2)) / 86_400_000 + 1).toBe(30);
});

test("отчётный месяц: стрелка у дат листает месяц и не превращает его в свои даты", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connectZen(page, "/categories");
  await expect(pressed(page)).toHaveText(/Отчётный месяц/);
  await prevRange(page).click();
  await expect(pressed(page)).toHaveText(/Отчётный месяц/);
  await expect(page.getByRole("button", { name: /Сентябрь/ }).first()).toBeVisible();
});
