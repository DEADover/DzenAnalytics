/**
 * «Обзор месяца» (#130): главная за любой месяц и по общим фильтрам. Месяц
 * выбирают на графике или в шапке, фильтр счетов пересчитывает и виджеты
 * месяца, и капитал с остатками.
 */
import { test, expect, connectZen } from "./harness";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

const tile = (page: import("@playwright/test").Page, name: string) =>
  page.locator(`[data-tour="widget-${name}"]`);

test("открывается на идущем месяце, раздел есть в меню «Ещё»", async ({ page }) => {
  await connectZen(page, "/");
  await page.getByRole("button", { name: "Ещё", exact: true }).click();
  await page.getByRole("link", { name: /^Обзор месяца/ }).click();
  await expect(page).toHaveURL(/\/overview$/);
  // Итоги — за идущий месяц, план из «Бюджета» стоит под расходом.
  await expect(tile(page, "month")).toContainText("Октябрь");
  await expect(tile(page, "month")).toContainText(/План\D*25\s000/);
  for (const name of ["cashflow", "categories", "monthOverMonth", "observations", "activity", "donutExpense", "capital", "accounts"]) {
    await expect(tile(page, name)).toBeVisible();
  }
});

test("столбец графика выбирает месяц и показывает его доходы по категориям", async ({ page }) => {
  await connectZen(page, "/overview");
  await expect(tile(page, "categories")).toContainText("Расходы по категориям");
  // Первый столбец доходов — самый старый месяц на графике.
  await tile(page, "cashflow").locator(".recharts-bar-rectangle").first().click();
  await expect(page).toHaveURL(/\/overview\?month=\d{4}-\d{2}$/);
  await expect(tile(page, "categories")).toContainText("Доходы по категориям");
  await expect(tile(page, "month")).toContainText("Месяц завершён");
  // Значок в дорожке периода возвращает к идущему месяцу.
  await page.getByRole("button", { name: /Вернуться к текущему месяцу/ }).click();
  await expect(page).toHaveURL(/\/overview$/);
  await expect(tile(page, "month")).toContainText("Октябрь");
});

test("месяц из ссылки и листание стрелками", async ({ page }) => {
  await connectZen(page, "/overview?month=2026-09");
  await expect(tile(page, "month")).toContainText("Сентябрь");
  await expect(tile(page, "month")).toContainText("Месяц завершён");
  // Первая дорожка — в шапке раздела; вторая, в общем фильтре, здесь погашена.
  await page.getByRole("button", { name: "Следующий период" }).first().click();
  await expect(page).toHaveURL(/\/overview$/);
  await expect(tile(page, "month")).toContainText("Октябрь");
  // Дальше идущего месяца листать некуда.
  await expect(page.getByRole("button", { name: "Дальше операций нет" }).first()).toBeDisabled();
});

test("фильтр счетов пересчитывает статьи, итоги и остатки; план не показывается", async ({ page }) => {
  await connectZen(page, "/overview");
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
  // Остатки — только по отмеченному счёту, без переключателя «в балансе / все».
  await expect(tile(page, "accounts")).toContainText("Наличные");
  await expect(tile(page, "accounts")).not.toContainText("Т-Банк");
});

test("раскладка обзора настраивается и хранится отдельно от главной", async ({ page }) => {
  await connectZen(page, "/overview");
  await expect(tile(page, "accounts")).toBeVisible();
  // «Свободных денег» и «Запланированных операций» здесь не бывает.
  await expect(tile(page, "upcoming")).toHaveCount(0);

  await page.getByRole("button", { name: "Настроить обзор" }).first().click();
  await tile(page, "accounts").getByRole("button", { name: "Убрать из обзора" }).click();
  await expect(tile(page, "accounts")).toHaveCount(0);
  // Снятый виджет ждёт в списке пустой клетки — вместе с «Кольцом доходов».
  await page.getByRole("button", { name: "Поставить сюда виджет" }).last().click();
  const picker = page.getByRole("dialog", { name: "Поставить виджет" });
  await expect(picker).toContainText("Балансы счетов");
  await expect(picker).toContainText("Кольцо доходов");
  await expect(picker).not.toContainText("Свободные деньги");
  await picker.getByRole("button", { name: /Кольцо доходов/ }).click();
  await expect(tile(page, "donutIncome")).toBeVisible();
  await page.getByRole("button", { name: "Готово" }).click();

  // Раскладка пережила перезагрузку, а главная осталась прежней.
  await page.reload();
  await expect(tile(page, "donutIncome")).toBeVisible();
  await expect(tile(page, "accounts")).toHaveCount(0);
  await page.goto("/");
  await expect(tile(page, "accounts")).toBeVisible();
  await expect(tile(page, "donutIncome")).toHaveCount(0);

  // «Сбросить» возвращает стандартный обзор.
  await page.goto("/overview");
  await expect(tile(page, "donutIncome")).toBeVisible();
  await page.getByRole("button", { name: "Настроить обзор" }).first().click();
  await page.getByRole("button", { name: "Сбросить", exact: true }).click();
  await expect(tile(page, "accounts")).toBeVisible();
  await expect(tile(page, "donutIncome")).toHaveCount(0);
});
