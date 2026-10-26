/**
 * Прогноз до конца месяца — как «План на день» в Дзен-мани: назначенные
 * операции ступенькой в свои дни, остаток бюджета ровно по оставшимся дням
 * (настройка «Размазывать план»). На «Сравнении» и на графике бюджета.
 */
import { test, expect, connectZen } from "./harness";
import type { Page, Locator } from "@playwright/test";

const money = (s: string) => Number(s.replace(/[^\d−-]/g, "").replace("−", "-"));

async function trackCard(page: Page): Promise<Locator> {
  const card = page.locator(".card-tray", { has: page.getByText(/График сравнения (расходов|доходов)/) });
  await card.scrollIntoViewIfNeeded();
  return card;
}

test("«Сравнение»: прогноз идущего месяца до конца, размазывание — переключателем", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connectZen(page, "/compare");
  const card = await trackCard(page);
  const forecast = card.getByTestId("compare-track-forecast");
  await expect(forecast).toContainText("Прогноз к 31 октября");
  const fact = money(
    await card.getByTestId("compare-track-summary").locator("span.font-semibold").first().innerText()
  );
  const smeared = money(await forecast.locator(".font-semibold").innerText());
  // Остаток бюджета «Продуктов» (25 000 в октябре) ложится сверху факта.
  expect(smeared).toBeGreaterThan(fact);

  const toggle = card.getByRole("switch", { name: "Размазывать план по дням" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  // Без размазывания расходов впереди нет (абонемент 12.10 просрочен) — прогноз = факт.
  await expect(forecast.locator(".font-semibold")).toHaveText(
    await card.getByTestId("compare-track-summary").locator("span.font-semibold").first().innerText()
  );
});

test("«Сравнение», доходы: аванс 25 октября — ступенькой в прогнозе", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connectZen(page, "/compare");
  const card = await trackCard(page);
  await card.getByRole("radio", { name: /Доходы/ }).or(card.getByRole("button", { name: /Доходы/ })).first().click();
  await expect(page.getByText("График сравнения доходов")).toBeVisible();
  const toggle = card.getByRole("switch", { name: "Размазывать план по дням" });
  if ((await toggle.getAttribute("aria-checked")) === "true") await toggle.click();
  const fact = money(
    await card.getByTestId("compare-track-summary").locator("span.font-semibold").first().innerText()
  );
  const forecast = money(await card.getByTestId("compare-track-forecast").locator(".font-semibold").innerText());
  expect(forecast - fact).toBe(30_000);
});

test("бюджет: «Размазывать план» на графике месяца, общий с «Сравнением»", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connectZen(page, "/budgets");
  await page.getByRole("radio", { name: "Месяц" }).or(page.getByRole("button", { name: "Месяц", exact: true })).first().click();
  const toggle = page.getByRole("switch", { name: "Размазывать план по дням" });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  // Цифры «Планов» Дзен-мани над графиком: ещё в планах и итог к концу месяца.
  const summary = page.getByTestId("month-plan-summary");
  await expect(summary).toContainText(/ещё в планах/i);
  await expect(summary).toContainText(/ещё поступит/i);
  await expect(summary).toContainText(/(свободно на конец месяца|не хватает до конца месяца)/i);
  // Разница — своей полосой под графиком, со своей шкалой и линией нуля.
  await expect(page.getByTestId("month-diff-strip").locator(".recharts-area")).toHaveCount(1);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  // Настройка одна: на «Сравнении» она тоже выключена.
  await page.goto("/compare");
  const card = await trackCard(page);
  await expect(card.getByRole("switch", { name: "Размазывать план по дням" })).toHaveAttribute("aria-checked", "false");
});
