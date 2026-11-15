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
