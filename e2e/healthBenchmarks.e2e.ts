/**
 * «Ориентиры» в «Финансовом здоровье» (#134): жильё и кредиты в доходе,
 * доля вложений в доходе, удвоение вложений. Настраиваются в своём окне.
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

test("ненастроенные ориентиры говорят, что отметить; настройки — значком у заголовка", async ({ page }) => {
  await connectZen(page, "/health");
  for (const id of ["housing", "debt", "invest", "doubling"]) {
    await expect(card(page, id)).toContainText("Не настроен");
    // Кнопки настройки на самих карточках нет — она одна, у заголовка блока.
    await expect(card(page, id).getByRole("button", { name: "Настроить" })).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Настроить ориентиры" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Что относится к жилью");
  await expect(dialog).toContainText("Инвестиционные счета");
  await expect(dialog).toContainText("Платежи по кредитам");
  await dialog.getByRole("button", { name: "Готово" }).click();
  await expect(dialog).toHaveCount(0);
});

test("карточку можно скрыть значком, «Отменить» и настройки её возвращают", async ({ page }) => {
  await connectZen(page, "/health");
  await card(page, "growth").getByRole("button", { name: "Скрыть «Рост расходов и доходов»" }).click();
  await expect(card(page, "growth")).toHaveCount(0);
  const toast = page.locator("[data-toast]");
  await expect(toast).toContainText("«Рост расходов и доходов» скрыт");
  await toast.getByRole("button", { name: "Отменить" }).click();
  await expect(card(page, "growth")).toHaveCount(1);

  // Скрыли все — блок говорит, где их вернуть.
  await configure(page, {
    housingOn: false, debtOn: false, investOn: false, doublingOn: false, growthOn: false, recurringOn: false,
  });
  await expect(page.locator("[data-benchmarks-empty]")).toContainText("Все ориентиры скрыты");
  await page.getByRole("button", { name: "Настроить ориентиры" }).click();
  await page.getByRole("dialog").getByRole("switch", { name: "Показывать «Расходы на жильё»" }).click();
  await expect(card(page, "housing")).toHaveCount(1);
});

test("на узком экране название карточки не обрезается", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await connectZen(page, "/health");
  for (const id of ["housing", "debt", "invest", "doubling", "growth", "recurring"]) {
    const title = card(page, id).locator("[data-benchmark-title] span");
    expect(await title.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("настроенные ориентиры считают по завершённым месяцам", async ({ page }) => {
  await connectZen(page, "/health");
  await configure(page, {
    housingCategories: ["Дом"],
    investAccounts: ["acc-save"],
    investRate: 12,
  });

  // Жильё: аренда 35 000 ₽ в месяц — ниже трети дохода.
  await expect(card(page, "housing")).toContainText("В норме");
  await expect(card(page, "housing")).toContainText("Норма — до 33%");
  await expect(card(page, "housing")).toContainText("35 000");

  // Вложения — переводы на накопительный счёт, 20 000 ₽ в месяц.
  await expect(card(page, "invest")).toContainText("Вкладываете");
  await expect(card(page, "invest")).toContainText("20 000");
  // 20 000 из 150 000 ₽ — 13%, цель по умолчанию 10%.
  await expect(card(page, "invest")).toContainText("13%");
  await expect(card(page, "invest")).toContainText("Цель — от 10%");
  await expect(card(page, "invest")).toContainText("Цель выполнена");

  // Правило 72: 12% годовых — 6 лет, 250 000 ₽ станут 500 000 ₽.
  await expect(card(page, "doubling")).toContainText("6 лет");
  await expect(card(page, "doubling")).toContainText("500 000");


  // Настройка сохранена.
  await expect
    .poll(async () => (await readMeta<{ housingCategories: string[] }>(page, "healthBenchmarks"))?.housingCategories)
    .toEqual(["Дом"]);
});

test("выключенный ориентир пропадает, порог меняет статус", async ({ page }) => {
  await connectZen(page, "/health");
  await configure(page, { housingCategories: ["Дом"], housingLimit: 10, doublingOn: false, investOn: false });
  await expect(card(page, "doubling")).toHaveCount(0);
  await expect(card(page, "invest")).toHaveCount(0);
  await expect(card(page, "housing")).toContainText("Намного выше нормы");
  await expect(card(page, "housing")).toContainText("Норма — до 10%");
});

test("оценка: главный шаг, история по месяцам и цель по подушке", async ({ page }) => {
  await connectZen(page, "/health");
  // История — линией под вердиктом, с разницей за отрезок.
  await expect(page.locator("[data-health-trend]")).toContainText("мес");
  // Подушка 7,9 месяца при цели 6: цель набрана, подтягивать нечего.
  const goal = page.locator("[data-cushion-goal]");
  const step = page.locator("[data-health-step]");
  await expect(goal).toContainText("Цель достигнута");
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

test("подписки в доходе и рост расходов к доходам", async ({ page }) => {
  await connectZen(page, "/health");
  // Истории три месяца — сравнивать половины не с чем.
  await expect(card(page, "growth")).toContainText("Мало данных");

  // Подписки: кинотеатр и аренда — оба платятся раз в месяц одной суммой.
  const subs = card(page, "recurring");
  await expect(subs).toContainText("Норма — до 10%");
  await expect(subs).toContainText("Намного выше нормы");
  const count = async () => Number((await subs.textContent())!.match(/(\d+) подпис/)![1]);
  const before = await count();
  expect(before).toBeGreaterThanOrEqual(2);
  // Аренда — жильё: отмеченная как жильё, из подписок она уходит.
  await configure(page, { housingCategories: ["Дом"] });
  await expect.poll(count).toBe(before - 1);
  await expect(subs).toContainText("В норме");
  await expect(subs.getByRole("link", { name: "Регулярные" })).toHaveAttribute("href", "/recurring");

  // Оба выключаются в настройках.
  await configure(page, { growthOn: false, recurringOn: false });
  await expect(card(page, "growth")).toHaveCount(0);
  await expect(subs).toHaveCount(0);
});

test("окно настроек: у каждого ориентира свой блок, вложения — общим блоком на две карточки", async ({ page }) => {
  await connectZen(page, "/health");
  await page.getByRole("button", { name: "Настроить ориентиры" }).click();
  const dialog = page.getByRole("dialog");
  const panel = (id: string) => dialog.locator(`[data-benchmark-settings="${id}"]`);

  // Счета и категории вложений стоят рядом с двумя карточками, которые по ним считают.
  const invest = panel("invest");
  await expect(invest).toContainText("Инвестиционные счета");
  await expect(invest.getByRole("switch", { name: "Показывать «Доля вложений в доходе»" })).toBeVisible();
  await expect(invest.getByRole("switch", { name: "Показывать «Удвоение вложений»" })).toBeVisible();
  await expect(invest).toContainText("Ожидаемая доходность");

  // Выключенный ориентир сворачивает свои настройки; пояснение остаётся.
  const housing = panel("housing");
  await expect(housing).toContainText("Что относится к жилью");
  await housing.getByRole("switch").click();
  await expect(housing).not.toContainText("Что относится к жилью");
  await expect(housing).toContainText("Какая часть дохода уходит на жильё");
  await expect(card(page, "housing")).toHaveCount(0);

  // Окно не шире экрана и без прокрутки вбок.
  expect(await dialog.evaluate((d) => d.scrollWidth <= d.clientWidth + 1)).toBe(true);
});
