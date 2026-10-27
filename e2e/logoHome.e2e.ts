/**
 * Знак DzenAnalytics в шапке ведёт на «Главную» — и в меню-дорожке на широком
 * окне, и отдельным знаком на узком, где меню спрятано в кнопку.
 */
import { test, expect, connectZen } from "./harness";

for (const width of [1440, 900]) {
  test(`клик по знаку возвращает на главную (ширина ${width})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await connectZen(page, "/transactions");
    await expect(page).toHaveURL(/\/transactions$/);
    await page.getByRole("link", { name: "На главную" }).filter({ visible: true }).click();
    await expect(page).toHaveURL(/\/$/);
  });
}
