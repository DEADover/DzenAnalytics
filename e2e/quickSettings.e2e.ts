/**
 * Быстрые настройки: шестерёнка в шапке открывает панель, набор собирается в
 * окне по карандашу, «Все настройки» ведут в раздел. «Скрыть суммы» прячет
 * деньги во всех разделах — клавишей H и плиткой.
 */
import type { Page } from "@playwright/test";
import { test, expect, connectZen } from "./harness";
import { ROUTES } from "./routes";

async function go(page: Page, to: string) {
  await page.evaluate((path) => {
    history.pushState(null, "", path);
    dispatchEvent(new PopStateEvent("popstate"));
  }, to);
  await page.waitForTimeout(350);
}

const gear = (page: Page) => page.getByRole("button", { name: "Быстрые настройки" });
const panel = (page: Page) => page.getByRole("dialog", { name: "Быстрые настройки" });

test("панель: набор по умолчанию, свой набор, переход в настройки", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page, "/");
  await gear(page).click();
  const p = panel(page);
  await expect(p.getByRole("switch", { name: /Скрыть суммы/ })).toBeVisible();
  await expect(p.getByRole("switch", { name: /Счета вне баланса/ })).toBeVisible();
  await expect(p.getByRole("group", { name: "Запланированные в ленте" })).toBeVisible();
  await expect(p.getByRole("group", { name: "Тема" })).toHaveCount(0);
  await expect(p.getByRole("slider", { name: "Размер текста в таблицах" })).toBeVisible();
  await expect(p.getByRole("switch", { name: /Строка из выписки/ })).toHaveCount(0);

  // Плитка переключает настройку прямо в панели.
  const kopecks = p.getByRole("switch", { name: /Копейки/ });
  await expect(kopecks).toHaveAttribute("aria-checked", "false");
  await kopecks.click();
  await expect(kopecks).toHaveAttribute("aria-checked", "true");
  await kopecks.click();

  // Свой набор: добавить «Строку из выписки».
  await p.getByRole("button", { name: "Настроить быстрые настройки" }).click();
  const modal = page.getByRole("dialog", { name: /Быстрые настройки/ }).last();
  await modal.getByRole("button", { name: "Поставить «Строка из выписки» в панель" }).click();
  await modal.getByRole("button", { name: "Готово" }).click();
  await gear(page).click();
  await expect(panel(page).getByRole("switch", { name: /Строка из выписки/ })).toBeVisible();

  // Все настройки.
  await panel(page).getByRole("button", { name: /Все настройки/ }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(panel(page)).toHaveCount(0);
});

test("«Скрыть суммы»: ни одной суммы цифрами ни в одном разделе", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page, "/");
  await expect(page.getByText(/\d ₽/).first()).toBeVisible();

  await page.keyboard.press("h");
  await expect(gear(page)).toHaveAttribute("title", /Суммы скрыты/);
  // Частицы — одним слоем поверх страницы.
  await expect(page.locator("canvas[data-amount-spoiler]")).toHaveCount(1);

  const money = /\d[\d   ,]*\s?[₽$€]/;
  const leaks: string[] = [];
  for (const route of ROUTES) {
    if (route === "/help" || route === "/import") continue;
    await go(page, route);
    const text = await page.locator("main").innerText();
    const m = text.match(money);
    if (m) leaks.push(`${route}: «${m[0]}»`);
    // Знак скрывается вместе с суммой.
    const sign = text.match(/[+\u2212-]\u2060/);
    if (sign) leaks.push(`${route}: знак перед суммой`);
  }
  expect(leaks).toEqual([]);

  // Плитка в панели показывает режим и выключает его.
  await go(page, "/");
  await gear(page).click();
  const tile = panel(page).getByRole("switch", { name: /Скрыть суммы/ });
  await expect(tile).toHaveAttribute("aria-checked", "true");
  await tile.click();
  await page.keyboard.press("Escape");
  await expect(page.locator("main").getByText(/\d ₽/).first()).toBeVisible();
  await expect(page.locator("canvas[data-amount-spoiler]")).toHaveCount(0);
});
