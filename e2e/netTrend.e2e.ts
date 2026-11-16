/**
 * «Cash-flow»: сглаженный тренд остатка — пунктир на графике и вывод словами
 * под ним. Считается по полным месяцам; по дням его нет.
 */
import { test, expect, connectZen, horizontalOverflow } from "./harness";

test("тренд остатка: линия в легенде и вывод словами", async ({ page }) => {
  await connectZen(page, "/cashflow");
  const verdict = page.locator("[data-net-trend]");
  await expect(verdict).toBeVisible();
  await expect(verdict).toContainText(/остаётся|Остаток|Расходы/);
  await expect(verdict).toContainText("сглаженный остаток за месяц:");
  await expect(page.getByText("Тренд остатка", { exact: true })).toBeVisible();
  // Вывод — одной строкой и не шире карточки.
  const box = await verdict.boundingBox();
  expect(box!.height).toBeLessThan(40);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  if (process.env.E2E_SHOTS) await page.screenshot({ path: process.env.E2E_SHOTS + "/net-trend.png" });
});
