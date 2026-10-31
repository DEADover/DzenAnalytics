/**
 * «Cash-flow»: помесячная сводка — справа от графика, прогноз — только там,
 * где период доходит до конца истории, и на коротком периоде короче.
 */
import { test, expect, connectZen } from "./harness";
import type { Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
});

const side = (page: Page) => page.locator("[data-cashflow-side]");
const forecastTab = (page: Page) => side(page).getByRole("radio", { name: "Прогноз" }).or(side(page).getByRole("button", { name: "Прогноз", exact: true })).first();
const drillSubtitle = (page: Page) =>
  page.evaluate(async () => {
    type S = { useDrillStore: { getState: () => { open: boolean; subtitle?: string; transactions: unknown[] } } };
    const s = (await (window as unknown as { __store: (n: string) => Promise<S> }).__store("useDrillStore")).useDrillStore.getState();
    return s.open ? `${s.subtitle}:${s.transactions.length}` : "";
  });
const legendForecast = (page: Page) =>
  page.locator(".recharts-legend-wrapper").getByText("Прогноз", { exact: true });

test("сводка справа от графика, прогноз — по переключателю", async ({ page }) => {
  await connectZen(page, "/cashflow");
  const panel = side(page);
  await panel.scrollIntoViewIfNeeded();
  const chart = page.locator(".recharts-wrapper").first();
  const p = (await panel.boundingBox())!;
  const c = (await chart.boundingBox())!;
  // Рядом, а не под графиком, и не выше его.
  expect(p.x).toBeGreaterThan(c.x + c.width - 1);
  expect(p.y + p.height).toBeLessThanOrEqual(c.y + c.height + 80);
  // Отдельной таблицы во всю ширину больше нет.
  await expect(page.getByText("Помесячная сводка", { exact: true })).toHaveCount(0);

  await expect(panel.locator("tbody tr").first()).toBeVisible();
  // Строка — операции месяца.
  await panel.locator("tbody tr").first().click();
  await expect.poll(() => drillSubtitle(page)).toMatch(/^Месяц:\d+/);
  await page.keyboard.press("Escape");
  await expect.poll(() => drillSubtitle(page)).toBe("");

  // Период «12 мес.» доходит до конца истории — прогноз есть: в легенде и в панели.
  await expect(legendForecast(page)).toBeVisible();
  await forecastTab(page).click();
  await expect(panel).toHaveAttribute("aria-label", "Прогноз по месяцам");
  const rows = await panel.locator("tbody tr").count();
  expect(rows).toBeGreaterThan(0);
  expect(rows).toBeLessThanOrEqual(6);
  if (process.env.E2E_SHOTS) {
    const card = page.locator(".card-tray", { has: panel });
    await card.screenshot({ path: process.env.E2E_SHOTS + "/cashflow-forecast.png" });
    await panel.getByRole("radio", { name: "Сводка" }).or(panel.getByRole("button", { name: "Сводка", exact: true })).first().click();
    await card.screenshot({ path: process.env.E2E_SHOTS + "/cashflow-summary.png" });
  }
});

test("год до декабря — прогноз до конца года; прошлый квартал — без прогноза", async ({ page }) => {
  await connectZen(page, "/cashflow");
  await expect(legendForecast(page)).toBeVisible();
  // Год заканчивается в декабре, история — в октябре (часы тестов): прогноз
  // есть и дотягивается до конца года.
  await page.locator("button", { hasText: /^Год$/ }).first().click();
  await expect(legendForecast(page)).toBeVisible();
  await forecastTab(page).click();
  await expect(side(page).locator("tbody tr").last()).toContainText("Дек");

  // Прошлый квартал закончился до последнего месяца истории — прогноза нет.
  await page.locator("button", { hasText: /^Квартал$/ }).first().click();
  await page.getByRole("button", { name: "Предыдущий квартал" }).first().click();
  await expect(legendForecast(page)).toHaveCount(0);
  await expect(forecastTab(page)).toHaveCount(0);
  await expect(side(page).getByText("Помесячная сводка", { exact: true })).toBeVisible();
});
