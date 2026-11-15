/**
 * «Год в цифрах»: баланс на начало года, сейчас, максимум и минимум (#132).
 */
import { test, expect, connectZen } from "./harness";

test("баланс за год — вторым рядом итогов, в одну строку", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page, "/year-review");
  const labels = ["Баланс на начало года", "Баланс сейчас", "Максимум за год", "Минимум за год"];
  const tops: number[] = [];
  for (const label of labels) {
    const cell = page.locator(".label", { hasText: label }).locator("xpath=ancestor::div[2]");
    await expect(cell).toContainText("₽");
    // Подпись не обрезана.
    const l = page.locator(".label", { hasText: label });
    expect(await l.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    tops.push(Math.round((await l.boundingBox())!.y));
  }
  expect(new Set(tops).size).toBe(1);
});
