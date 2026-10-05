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
  const card = page.locator(".card-tray", { has: page.getByText("График сравнения расходов") });
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

  // Переключатель свой: таблица категорий остаётся на расходах.
  await card.getByRole("radio", { name: /Доходы/ }).or(card.getByRole("button", { name: /Доходы/ })).first().click();
  await expect(page.getByText("График сравнения доходов")).toBeVisible();
  await expect(page.getByText("Сравнение расходов по категориям")).toBeVisible();
});

test("один и тот же месяц в А и Б выбрать нельзя, календарь — по центру кнопки", async ({ page }) => {
  await connectZen(page, "/compare");
  // Октябрь против сентября. Открываем календарь периода Б.
  const head = (name: string) => page.locator("th", { hasText: name });
  const pickerB = head("Период Б").getByRole("button", { name: /Сентябрь/ });
  await pickerB.click();
  const panel = page.locator(".fixed.card.w-64");
  await expect(panel).toBeVisible();
  // Октябрь занят периодом А — погашен.
  await expect(panel.getByRole("button", { name: "Окт", exact: true })).toBeDisabled();
  // Панель по центру кнопки (±2 px).
  const b = (await pickerB.boundingBox())!;
  const p = (await panel.boundingBox())!;
  expect(Math.abs(b.x + b.width / 2 - (p.x + p.width / 2))).toBeLessThan(2);
  // Б выбираем руками — август; теперь у А погашен август.
  await panel.getByRole("button", { name: "Авг", exact: true }).click();
  const pickerA = head("Период А").getByRole("button", { name: /Октябрь/ });
  await pickerA.click();
  await expect(panel.getByRole("button", { name: "Авг", exact: true })).toBeDisabled();
  await panel.getByRole("button", { name: "Сен", exact: true }).click();
  // Стрелка «назад» у А с сентября перешагивает август (он у Б) — на июль.
  await head("Период А").getByTitle("Предыдущий месяц").click();
  await expect(head("Период А").getByRole("button", { name: /Июль/ })).toBeVisible();
});
