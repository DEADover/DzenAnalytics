/**
 * Журнал синхронизаций: итог записи («Без изменений», «+N новых/изменённых»,
 * «Отправлено: N») — своим столбцом «Результат», а не хвостом к типу.
 */
import { test, expect, connectZen } from "./harness";

test("журнал: тип и результат — разными столбцами, в одну строку", async ({ page }) => {
  await connectZen(page, "/settings");
  await page.getByText("Журнал синхронизаций", { exact: true }).click();
  const table = page.locator("table", { has: page.getByRole("columnheader", { name: /Результат/ }) });
  await expect(table).toBeVisible();
  const row = table.locator("tbody tr").first();
  const cells = row.locator("td");
  await expect(cells.nth(0)).toHaveText(/синхронизация/i);
  await expect(cells.nth(1)).not.toHaveText(/синхронизация/i);
  // Ни одна ячейка строки не переносится на вторую строку.
  const heights = await cells.evaluateAll((tds) => tds.map((td) => Math.round(td.getBoundingClientRect().height)));
  expect(new Set(heights).size).toBe(1);
  if (process.env.E2E_SHOTS) await table.screenshot({ path: process.env.E2E_SHOTS + "/sync-log.png" });
});
