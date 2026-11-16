/**
 * «Тренды» → список категорий под графиком: маленький график, группа тренда и
 * изменение между первым и последним полным месяцем; отметка включает линию
 * категории на графике.
 */
import { test, expect, connectZen, horizontalOverflow } from "./harness";

test("тренды категорий: группы, изменение и выбор линий на графике", async ({ page }) => {
  await connectZen(page, "/trends");
  const block = page.locator("[data-trend-table]");
  await expect(block).toBeVisible();
  // Идущий октябрь в тренды не входит: полные месяцы — май … сентябрь.
  await expect(block).toContainText("По полным месяцам: Май 2026 — Сентябрь 2026");
  await expect(block).toContainText("Общий расход:");

  const rows = block.locator("tbody tr");
  expect(await rows.count()).toBeGreaterThan(2);
  // У каждой строки — группа тренда словом.
  for (const text of await block.locator("tbody tr td:nth-child(4)").allTextContents()) {
    expect(text.trim()).toMatch(/^(Растёт|Плавает|Снижается)$/);
  }
  // Шапка: месяцы периода вместо «Было / Стало».
  await expect(block.locator("thead")).toContainText("Май 26 г.");
  await expect(block.locator("thead")).toContainText("Сент. 26 г.");

  // Отметка строки включает на графике именно эту категорию.
  const first = rows.first();
  const name = ((await first.locator("td").nth(1).textContent()) ?? "").trim();
  await first.getByRole("checkbox").check();
  await expect(page.getByText("Выбрано: 1")).toBeVisible();
  await expect(page.locator(".recharts-legend-item")).toHaveText([name]);
  await page.getByText("Выбрано: 1").locator("xpath=..").getByRole("button", { name: "Сбросить" }).click();
  await expect(page.getByText(/Авто: топ-5/)).toBeVisible();

  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  await block.scrollIntoViewIfNeeded();
  if (process.env.E2E_SHOTS) await page.screenshot({ path: process.env.E2E_SHOTS + "/trends.png", fullPage: false });
});
