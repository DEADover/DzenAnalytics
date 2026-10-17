/**
 * «Cash-flow» на коротком периоде: графики по дням, а не одной точкой месяца.
 */
import { test, expect, connectZen } from "./harness";

test("отчётный месяц — все три вида по дням", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await connectZen(page, "/cashflow");
  await page.locator("button", { hasText: "Отчётный месяц" }).first().click();
  const seg = (name: string) => page.getByRole("radio", { name }).or(page.getByRole("button", { name, exact: true })).first();
  const card = page.locator(".card-tray", { has: seg("Зеркало") }).first();
  // Часы тестов — 15 октября: в месяце 15 дней с данными.
  await expect(card.getByText("15 дн.", { exact: true })).toBeVisible();
  await expect(card.getByText("Доходы и расходы по дням", { exact: true })).toBeVisible();

  const drillSubtitle = () =>
    page.evaluate(async () => {
      type S = { useDrillStore: { getState: () => { open: boolean; subtitle?: string; transactions: unknown[] } } };
      const s = (await (window as unknown as { __store: (n: string) => Promise<S> }).__store("useDrillStore")).useDrillStore.getState();
      return s.open ? `${s.subtitle}:${s.transactions.length}` : "";
    });

  for (const mode of ["Бары", "Поток", "Зеркало"]) {
    await seg(mode).click();
    const surface = card.locator(".recharts-wrapper > svg.recharts-surface").first();
    await surface.scrollIntoViewIfNeeded();
    // Ось — числа месяца, не одна подпись «Окт. 26 г.».
    const dayTicks = async () =>
      (await surface.locator(".recharts-cartesian-axis-tick-label").allTextContents()).filter((t) => /^\d{1,2}$/.test(t.trim())).length;
    await expect.poll(dayTicks, { message: mode }).toBeGreaterThan(4);
    // Нажатие — операции дня.
    const box = (await surface.boundingBox())!;
    // 5 октября — зарплата: x по номеру дня из 15.
    await page.mouse.move(box.x + 60 + ((box.width - 70) * 4) / 14, box.y + box.height * 0.5);
    await page.waitForTimeout(250);
    await page.mouse.click(box.x + 60 + ((box.width - 70) * 4) / 14, box.y + box.height * 0.5);
    await expect.poll(drillSubtitle, { message: mode }).toMatch(/^День:\d+/);
    await page.keyboard.press("Escape");
    await expect.poll(drillSubtitle).toBe("");
  }
});

test("год — по-прежнему помесячно", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await connectZen(page, "/cashflow");
  const card = page.locator(".card-tray", { has: page.getByText("Доходы и расходы по месяцам", { exact: true }) });
  await expect(card.getByText(/^\d+ мес\.$/)).toBeVisible();
});

test("«Поток»: в подсказке дня только категории с тратами", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await connectZen(page, "/cashflow");
  await page.locator("button", { hasText: "Отчётный месяц" }).first().click();
  const seg = page.getByRole("radio", { name: "Поток" }).or(page.getByRole("button", { name: "Поток", exact: true })).first();
  await seg.click();
  const card = page.locator(".card-tray", { has: seg }).first();
  const surface = card.locator(".recharts-wrapper > svg.recharts-surface").first();
  await surface.scrollIntoViewIfNeeded();
  const box = (await surface.boundingBox())!;
  // 10 октября — аренда и продукты, остальные категории в этот день пустые.
  await page.mouse.move(box.x + 60 + ((box.width - 70) * 9) / 14, box.y + box.height * 0.5);
  const tip = card.locator(".recharts-tooltip-wrapper");
  await expect(tip).toContainText("октября");
  const values = await tip.locator("span, div").allTextContents();
  expect(values.filter((v) => v.trim() === "0 ₽")).toEqual([]);
});
