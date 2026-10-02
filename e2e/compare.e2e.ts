/**
 * «Сравнение периодов»: колонка «Изменение» — разница и процент в скобках (#115).
 */
import { test, expect, connectZen } from "./harness";

test("«Изменение»: разница в единицах метрики и процент в скобках", async ({ page }) => {
  await connectZen(page, "/compare");
  const table = page.locator("table").first();
  const change = (label: string) => table.locator("tr", { hasText: label }).locator("td").last();
  // Октябрь (по 15-е, со всплеском в кафе) против того же отрезка сентября.
  await expect(change("Расходы")).toHaveText(/^▲ 11\s955 ₽ \(25%\)$/);
  await expect(change("Операций")).toHaveText(/^▲ 3 \(27%\)$/);
  // Пилюля целиком в своей ячейке.
  const fits = await change("Средний чек").evaluate((td) => {
    const pill = td.querySelector("span") as HTMLElement;
    return pill.getBoundingClientRect().right <= td.getBoundingClientRect().right;
  });
  expect(fits).toBe(true);
});
