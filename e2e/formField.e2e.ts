/**
 * Общее поле формы (`FormField`): поля одного ряда начинаются на одной
 * высоте, даже если у части ярлыков есть «ⓘ» или пометка.
 */
import { test, expect, connectZen } from "./harness";

test("форма цели: поля в ряду на одной высоте, с «ⓘ» и без", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page, "/goals");
  await page.getByRole("button", { name: /Добавить|Новая цель|Создать/ }).first().click();
  const fields = page.locator("input:visible, [role=combobox]:visible");
  await expect.poll(() => fields.count()).toBeGreaterThanOrEqual(4);
  const tops = await fields.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  // Два ряда по три поля: в каждом ряду — одна высота.
  expect(new Set(tops).size).toBeLessThanOrEqual(2);
});
