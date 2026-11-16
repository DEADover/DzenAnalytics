/**
 * «Фильтры и выбор месяца» на главной (#130): настройка включается в режиме
 * «Настроить главную»; с ней главная считает за выбранный месяц и по общим
 * фильтрам, а без неё остаётся прежней.
 */
import { test, expect, connectZen } from "./harness";
import type { Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

const tile = (page: Page, name: string) => page.locator(`[data-tour="widget-${name}"]`);

/** Включить настройку так, как это делает человек: в режиме настройки главной. */
async function turnOn(page: Page) {
  await expect(tile(page, "month")).toBeVisible();
  await page.getByRole("button", { name: "Настроить главную" }).first().click();
  await page.getByRole("switch", { name: "Фильтры и выбор месяца" }).click();
  await page.getByRole("button", { name: "Готово" }).click();
}

test("по умолчанию главная прежняя: ни фильтров, ни листания месяца", async ({ page }) => {
  await connectZen(page, "/");
  await expect(tile(page, "month")).toBeVisible();
  await expect(page.getByRole("button", { name: "Предыдущий период" })).toHaveCount(0);
  await expect(page.getByPlaceholder(/Фильтр: получатель/)).toHaveCount(0);
  // Месяц из ссылки без настройки не действует.
  await page.goto("/?month=2026-08");
  await expect(tile(page, "month")).toContainText("Октябрь");
});

test("настройка включает фильтры и листание; столбец графика выбирает месяц", async ({ page }) => {
  await connectZen(page, "/");
  await turnOn(page);
  await expect(page.getByPlaceholder(/Фильтр: получатель/)).toBeVisible();
  await expect(tile(page, "month")).toContainText("Октябрь");
  await expect(tile(page, "month")).toContainText(/План\D*25\s000/);

  // Первый столбец доходов — самый старый месяц на графике.
  await tile(page, "cashflow").locator(".recharts-bar-rectangle").first().click();
  await expect(page).toHaveURL(/\/\?month=\d{4}-\d{2}$/);
  await expect(tile(page, "categories")).toContainText("Доходы по категориям");
  await expect(tile(page, "month")).toContainText("Месяц завершён");
  // Запланированные операции остаются про идущий месяц.
  await expect(tile(page, "upcoming")).toBeVisible();

  // Значок в дорожке периода возвращает к идущему месяцу.
  await page.getByRole("button", { name: /Вернуться к текущему месяцу/ }).first().click();
  await expect(page).toHaveURL(/\/$/);
  await expect(tile(page, "month")).toContainText("Октябрь");

  // Настройка пережила перезагрузку; месяц из ссылки открывается сразу.
  await page.goto("/?month=2026-09");
  await expect(tile(page, "month")).toContainText("Сентябрь");
  await page.getByRole("button", { name: "Следующий период" }).first().click();
  await expect(tile(page, "month")).toContainText("Октябрь");
  await expect(page.getByRole("button", { name: "Дальше операций нет" }).first()).toBeDisabled();
});

test("фильтр счетов пересчитывает статьи, итоги и остатки; план не показывается", async ({ page }) => {
  await connectZen(page, "/");
  await turnOn(page);
  const rows = tile(page, "categories").locator("[data-categories-list] button");
  await expect.poll(() => rows.count()).toBeGreaterThan(1);
  await expect(tile(page, "accounts")).toContainText("Т-Банк");

  await page.evaluate(async () => {
    type S = { getState: () => { setSet: (kind: string, values: Set<string>) => void } };
    const store = (window as unknown as { __store: (n: string) => Promise<Record<string, S>> }).__store;
    const { useFiltersStore } = await store("useFiltersStore");
    useFiltersStore.getState().setSet("accounts", new Set(["acc-cash"]));
  });

  // С наличных в этом месяце одна трата.
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Еда вне дома");
  // План считается по всем счетам — под фильтром его рядом с фактом нет.
  await expect(tile(page, "month")).not.toContainText("План");
  // Остатки — только по отмеченному счёту.
  await expect(tile(page, "accounts")).toContainText("Наличные");
  await expect(tile(page, "accounts")).not.toContainText("Т-Банк");
});

test("выключенная настройка возвращает главную к идущему месяцу и всем счетам", async ({ page }) => {
  await connectZen(page, "/");
  await turnOn(page);
  await page.goto("/?month=2026-09");
  await expect(tile(page, "month")).toContainText("Сентябрь");
  await turnOn(page);
  await expect(tile(page, "month")).toContainText("Октябрь");
  await expect(page.getByPlaceholder(/Фильтр: получатель/)).toHaveCount(0);
});
