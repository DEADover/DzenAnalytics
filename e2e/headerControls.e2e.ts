/**
 * Настройки раздела — в шапке, рядом с названием, а не отдельным рядом под
 * общим фильтром (решение 26.10.2026).
 */
import { test, expect, connectZen } from "./harness";

for (const [path, title, button] of [
  ["/categories", "Категории", "Доходы"],
  ["/accounts", "Счета", "Движение"],
  ["/budgets", "Бюджет", "Год"],
] as const) {
  test(`${title}: «${button}» — в шапке раздела`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await connectZen(page, path);
    const h1 = page.locator("main h1", { hasText: title });
    await expect(h1).toBeVisible();
    const header = h1.locator("xpath=ancestor::div[contains(@class,'-mb-3')][1]");
    await expect(header.getByText(button, { exact: true })).toBeVisible();
  });
}
