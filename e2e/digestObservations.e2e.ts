/**
 * «Наблюдения» — в «Дайджесте», плитками за выбранный период. В «Cash-flow»
 * старых «Автонаблюдений» больше нет.
 */
import { test, expect, connectZen } from "./harness";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("наблюдения за месяц — плитками в «Дайджесте»", async ({ page }) => {
  await connectZen(page, "/digest?month=2026-09");
  await expect(page.getByText("Главное за Сентябрь 2026")).toBeVisible();
  const block = page.locator(".card-tray", { has: page.getByText("Наблюдения", { exact: true }) });
  await expect(block).toBeVisible();
  const tiles = block.locator("[data-observation]");
  expect(await tiles.count()).toBeGreaterThanOrEqual(3);
  await expect(block.locator('[data-observation="Будни и выходные"]')).toBeVisible();
  // У завершённого месяца — и половины месяца.
  await expect(block.locator('[data-observation="Половины месяца"]')).toBeVisible();
  // Плитки одной высоты в ряду и подписи не обрезаны.
  const firstRow = await tiles.evaluateAll((els) => {
    const top = els[0].getBoundingClientRect().top;
    return els.filter((e) => Math.abs(e.getBoundingClientRect().top - top) < 2).map((e) => Math.round(e.getBoundingClientRect().height));
  });
  expect(new Set(firstRow).size).toBe(1);
  if (process.env.E2E_SHOTS) {
    await block.scrollIntoViewIfNeeded();
    await block.screenshot({ path: process.env.E2E_SHOTS + "/digest-observations.png" });
  }
});

test("идущий месяц — без «половин»: вторая ещё не прожита", async ({ page }) => {
  await connectZen(page, "/digest?month=2026-10");
  const block = page.locator(".card-tray", { has: page.getByText("Наблюдения", { exact: true }) });
  await expect(block).toBeVisible();
  await expect(block.locator('[data-observation="Половины месяца"]')).toHaveCount(0);
});

test("в «Cash-flow» автонаблюдений больше нет", async ({ page }) => {
  await connectZen(page, "/cashflow");
  await expect(page.getByText("Доходы и расходы по месяцам")).toBeVisible();
  await expect(page.getByText("Автонаблюдения")).toHaveCount(0);
});
