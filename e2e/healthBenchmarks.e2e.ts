/**
 * «Ориентиры» в «Финансовом здоровье» (#134): жильё и кредиты в доходе,
 * инвестиции к роскоши, удвоение вложений. Настраиваются в своём окне.
 */
import { test, expect, connectZen, readMeta } from "./harness";
import type { Page } from "@playwright/test";

const card = (page: Page, id: string) => page.locator(`[data-benchmark="${id}"]`);

async function configure(page: Page, patch: Record<string, unknown>) {
  await page.evaluate(async (p) => {
    type S = { getState: () => { update: (v: unknown) => Promise<void> } };
    const w = window as unknown as { __store: (n: string) => Promise<{ useBenchmarksStore: S }> };
    const { useBenchmarksStore } = await w.__store("useBenchmarksStore");
    await useBenchmarksStore.getState().update(p);
  }, patch);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("ненастроенные ориентиры зовут в настройки, окно открывается и закрывается", async ({ page }) => {
  await connectZen(page, "/health");
  for (const id of ["housing", "debt", "luxury", "doubling"]) {
    await expect(card(page, id).getByRole("button", { name: "Настроить" })).toBeVisible();
  }
  await card(page, "housing").getByRole("button", { name: "Настроить" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Категории жилья");
  await expect(dialog).toContainText("Счета инвестиций");
  await dialog.getByRole("button", { name: "Готово" }).click();
  await expect(dialog).toHaveCount(0);
  // Та же настройка — кнопкой в шапке раздела.
  await page.getByRole("button", { name: "Настроить ориентиры" }).click();
  await expect(page.getByRole("dialog")).toContainText("Платежи по кредитам");
});

test("настроенные ориентиры считают по завершённым месяцам", async ({ page }) => {
  await connectZen(page, "/health");
  await configure(page, {
    housingCategories: ["Дом"],
    luxuryCategories: ["Еда вне дома"],
    investAccounts: ["acc-save"],
    investRate: 12,
  });

  // Жильё: аренда 35 000 ₽ в месяц — ниже трети дохода.
  await expect(card(page, "housing")).toContainText("В норме");
  await expect(card(page, "housing")).toContainText("норма до 33%");
  await expect(card(page, "housing")).toContainText("35 000");

  // Вложения — переводы на накопительный счёт, 20 000 ₽ в месяц.
  await expect(card(page, "luxury")).toContainText("Вложено");
  await expect(card(page, "luxury")).toContainText("20 000");
  await expect(card(page, "luxury")).toContainText("цель ×2");

  // Правило 72: 12% годовых — 6 лет, 250 000 ₽ станут 500 000 ₽.
  await expect(card(page, "doubling")).toContainText("6 лет");
  await expect(card(page, "doubling")).toContainText("500 000");

  // Заголовки карточек не обрезаны, статус не переносится.
  for (const id of ["housing", "luxury", "doubling"]) {
    const title = card(page, id).locator("span.truncate").first();
    expect(await title.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  }

  // Настройка сохранена.
  await expect
    .poll(async () => (await readMeta<{ housingCategories: string[] }>(page, "healthBenchmarks"))?.housingCategories)
    .toEqual(["Дом"]);
});

test("выключенный ориентир пропадает, порог меняет статус", async ({ page }) => {
  await connectZen(page, "/health");
  await configure(page, { housingCategories: ["Дом"], housingLimit: 10, doublingOn: false, luxuryOn: false });
  await expect(card(page, "doubling")).toHaveCount(0);
  await expect(card(page, "luxury")).toHaveCount(0);
  await expect(card(page, "housing")).toContainText("Высоко");
  await expect(card(page, "housing")).toContainText("норма до 10%");
});

test("оценка: главный шаг, история по месяцам и цель по подушке", async ({ page }) => {
  await connectZen(page, "/health");
  // История — линией под вердиктом, с разницей за отрезок.
  await expect(page.locator("[data-health-trend]")).toContainText("мес");
  // Подушка 7,9 месяца при цели 6: цель набрана, подтягивать нечего.
  const goal = page.locator("[data-cushion-goal]");
  const step = page.locator("[data-health-step]");
  await expect(goal).toContainText("Цель набрана");
  await expect(step).toHaveCount(0);
  const overallBefore = Number(await page.locator(".text-5xl").first().textContent());

  // Цель 12 месяцев: подушка считается к ней, выбор сохраняется.
  await goal.getByRole("button", { name: "12 мес" }).click();
  await expect
    .poll(async () => (await readMeta<{ cushionTarget: number }>(page, "healthBenchmarks"))?.cushionTarget)
    .toBe(12);
  await expect(goal).toContainText(/Ещё .*₽.* — при текущем темпе к [а-я]+ \d{4}/);
  expect(Number(await page.locator(".text-5xl").first().textContent())).toBeLessThan(overallBefore);

  // Теперь главный шаг — про подушку, с суммой и приростом оценки.
  await expect(step).toContainText("Главный шаг.");
  await expect(step).toContainText("12 месяцев");
  await expect(step).toContainText(/Оценка вырастет с \d+ до \d+\./);

  // Строка цели — в одну линию: переключатель и прогноз не переносятся.
  const mids = await goal
    .locator(":scope > *")
    .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2)));
  expect(Math.max(...mids) - Math.min(...mids)).toBeLessThanOrEqual(2);
});
