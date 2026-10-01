/**
 * Прогноз остатка до конца месяца на «Счетах» — пунктир по запланированным.
 */
import { test, expect, connectZen } from "./harness";

test("«Совокупно»: прогноз до конца месяца по будущим планам, без просроченных", async ({ page }) => {
  await connectZen(page, "/accounts");
  await page.getByRole("button", { name: "Совокупно" }).click();
  // Аванс +30 000 25 октября — в прогнозе; абонемент 12 октября просрочен и
  // в прогноз не идёт, иначе было бы +27 000.
  const caption = page.getByText(/Прогноз по запланированным операциям: к 31 октября 2026/);
  await expect(caption).toBeVisible();
  await expect(caption).toContainText(/\(\+30\s000\s₽\)/);
});

test("прошлый месяц — без прогноза", async ({ page }) => {
  await connectZen(page, "/accounts");
  await page.getByRole("button", { name: "Совокупно" }).click();
  await page.getByRole("button", { name: "Предыдущий период" }).click();
  await expect(page.getByText(/Прогноз по запланированным/)).toHaveCount(0);
});
