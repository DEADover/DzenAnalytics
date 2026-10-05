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

test("нарастающий итог по дням: идущий месяц до сегодня, прошлый целиком (#117)", async ({ page }) => {
  await connectZen(page, "/compare");
  const card = page.locator(".card-tray", { has: page.getByText("Расходы нарастающим итогом") });
  await expect(card).toBeVisible();
  const summary = card.getByTestId("compare-track-summary");
  // Октябрь идёт до 15-го — сравнивается с тем, что было в сентябре к 15-му:
  // та же разница, что у «Расходов» в таблице выше.
  await expect(summary).toContainText("на 15 октября");
  await expect(summary).toContainText("к тому же дню");
  await expect(summary).toContainText(/▲ 11\s955 ₽ \(25%\)/);
  await expect(summary).toContainText("целиком");
  // Две линии: сплошная (октябрь) и пунктир (сентябрь).
  await expect(card.locator(".recharts-line")).toHaveCount(2);

  // Переключатель общий с таблицей категорий.
  await card.getByRole("radio", { name: /Доходы/ }).or(card.getByRole("button", { name: /Доходы/ })).first().click();
  await expect(page.getByText("Доходы нарастающим итогом")).toBeVisible();
  await expect(page.getByText(/^Доходы по категориям:/)).toBeVisible();
});
