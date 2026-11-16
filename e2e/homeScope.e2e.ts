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
  // Где стоят кнопки «Итогов месяца» до фильтра — после него они не должны съехать.
  const cta = tile(page, "month").getByRole("link", { name: "Лента операций" });
  const before = await cta.boundingBox();

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
  await expect(tile(page, "month").getByText(/^План/).first()).toBeHidden();
  // Строка плана скрыта, но место держит: блок не прыгает от смены фильтра.
  const after = await cta.boundingBox();
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(1);
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

/** Поставить общий фильтр так же, как это делает панель фильтров. */
async function setFilter(page: Page, kind: string, values: string[]) {
  await page.evaluate(
    async ([k, v]) => {
      type S = { getState: () => { setSet: (kind: string, values: Set<string>) => void } };
      const store = (window as unknown as { __store: (n: string) => Promise<Record<string, S>> }).__store;
      const { useFiltersStore } = await store("useFiltersStore");
      useFiltersStore.getState().setSet(k as string, new Set(v as string[]));
    },
    [kind, values] as const
  );
}

/** Поставить на главную виджеты, которые стандартно сняты. */
async function showWidgets(page: Page, keys: string[]) {
  await page.evaluate(async (list) => {
    type S = { getState: () => { setHidden: (key: string, hidden: boolean) => Promise<void> } };
    const store = (window as unknown as { __store: (n: string) => Promise<Record<string, S>> }).__store;
    const { useDashboardLayoutStore } = await store("useDashboardLayoutStore");
    for (const key of list) await useDashboardLayoutStore.getState().setHidden(key, false);
  }, keys);
}

/** Крупное число виджета — первое, что в нём набрано моноширинным. */
const bigNumber = (page: Page, name: string) =>
  tile(page, name).locator(".font-mono").first().innerText();

test("фильтр статей меняет график и итоги, но не капитал и не свободные деньги", async ({ page }) => {
  await connectZen(page, "/");
  // Часть виджетов стандартно снята — ставим, чтобы сверить их с фильтром.
  await showWidgets(page, ["freeMoney", "capital"]);
  await turnOn(page);
  await expect(tile(page, "freeMoney")).toBeVisible();
  const before = {
    month: await bigNumber(page, "month"),
    accounts: await bigNumber(page, "accounts"),
    capital: await bigNumber(page, "capital"),
    free: await tile(page, "freeMoney").innerText(),
    planned: await tile(page, "upcoming").innerText(),
  };

  // Только «Дом»: сальдо месяца другое, а деньги на счетах те же.
  await setFilter(page, "categories", ["Дом"]);
  await expect.poll(() => bigNumber(page, "month")).not.toBe(before.month);
  const rows = tile(page, "categories").locator("[data-categories-list] button");
  await expect(rows).toHaveCount(1);
  expect(await bigNumber(page, "accounts")).toBe(before.accounts);
  expect(await bigNumber(page, "capital")).toBe(before.capital);

  // Фильтр счетов меняет и капитал, и остатки — но не «Свободные деньги» и не
  // «Запланированные операции»: они про идущий месяц и весь бюджет.
  await setFilter(page, "categories", []);
  await setFilter(page, "accounts", ["acc-cash"]);
  await expect.poll(() => bigNumber(page, "accounts")).not.toBe(before.accounts);
  await expect.poll(() => bigNumber(page, "capital")).not.toBe(before.capital);
  expect(await tile(page, "freeMoney").innerText()).toBe(before.free);
  expect(await tile(page, "upcoming").innerText()).toBe(before.planned);
});

test("виджеты месяца следуют выбранному месяцу; статья открывает его операции", async ({ page }) => {
  await connectZen(page, "/");
  await showWidgets(page, ["donutExpense", "donutIncome", "capital", "monthOverMonth", "activity"]);
  await turnOn(page);
  const october = {
    month: await bigNumber(page, "month"),
    mom: await tile(page, "monthOverMonth").innerText(),
    donut: await tile(page, "donutExpense").innerText(),
    activity: await tile(page, "activity").innerText(),
    capital: await bigNumber(page, "capital"),
    accounts: await bigNumber(page, "accounts"),
  };

  await page.goto("/?month=2026-08");
  await expect(tile(page, "month")).toContainText("Август");
  expect(await bigNumber(page, "month")).not.toBe(october.month);
  expect(await tile(page, "monthOverMonth").innerText()).not.toBe(october.mom);
  expect(await tile(page, "donutExpense").innerText()).not.toBe(october.donut);
  expect(await tile(page, "activity").innerText()).not.toBe(october.activity);
  await expect(tile(page, "activity")).toContainText("авг");
  await expect(tile(page, "donutIncome")).toContainText("150");
  // Капитал и остатки к месяцу не привязаны.
  expect(await bigNumber(page, "capital")).toBe(october.capital);
  expect(await bigNumber(page, "accounts")).toBe(october.accounts);

  // Сравнение прошедшего месяца: с предыдущим или с идущим.
  await expect(tile(page, "monthOverMonth")).toContainText("В июле");
  await tile(page, "monthOverMonth").getByRole("button", { name: "С текущим" }).click();
  await expect(tile(page, "monthOverMonth")).toContainText(/В октябре за те же 15 дней/);
  await expect(tile(page, "monthOverMonth")).toContainText("Сейчас");

  // Клик по статье — её операции именно за выбранный месяц.
  await tile(page, "categories").locator("[data-categories-list] button", { hasText: /^Дом/ }).click();
  const drawer = page.getByRole("complementary").filter({ hasText: "Дом · Август 2026" });
  await expect(drawer).toContainText("Расходы по статье");
  await expect(drawer).toContainText(/Операций\s*1/);
  await expect(drawer).toContainText(/35\s000/);
});
