/**
 * «Выделение строки щелчком» (Настройки → Оформление): выключено — одиночный
 * щелчок по строке операции её не отмечает; галочка и двойной щелчок
 * работают как раньше.
 */
import { test, expect, connectZen } from "./harness";

test("выключили «Выделение строки щелчком» — щелчок не отмечает, галочка и двойной щелчок работают", async ({ page }) => {
  await connectZen(page, "/settings?tab=interface");
  const sw = page.getByRole("switch", { name: "Выделение строки щелчком" });
  await expect(sw).toBeChecked();
  await sw.click();
  await expect(sw).not.toBeChecked();

  await page.goto("/transactions");
  const row = page.locator(".op-row").nth(1);
  const bar = page.getByRole("region", { name: "Массовые действия" });
  await row.locator("[data-cell]").last().click();
  // Отложенное выделение ждёт порог двойного щелчка — даём ему время.
  await page.waitForTimeout(400);
  await expect(bar).toHaveCount(0);
  await expect(row).not.toHaveClass(/bg-accent\/5/);

  // Галочка отмечает.
  await row.getByRole("checkbox", { name: "Выбрать операцию" }).check();
  await expect(bar.getByText(/^Выбрано:/)).toBeVisible();
  await row.getByRole("checkbox", { name: "Выбрать операцию" }).uncheck();

  // Двойной щелчок открывает операцию.
  await row.locator("[data-cell]").last().dblclick();
  await expect(page.getByRole("dialog").filter({ hasText: "Редактирование операции" })).toBeVisible();
});

test("по умолчанию щелчок по строке отмечает её", async ({ page }) => {
  await connectZen(page, "/transactions");
  const row = page.locator(".op-row").nth(1);
  await row.locator("[data-cell]").last().click();
  await expect(page.getByRole("region", { name: "Массовые действия" }).getByText(/^Выбрано:/)).toBeVisible();
});
