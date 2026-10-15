/**
 * «Контрагенты»: места за период, карточка места, новые и пропавшие места.
 */
import { test, expect, connectZen, horizontalOverflow } from "./harness";

test("места за месяц, карточка места и новые места", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connectZen(page, "/counterparties");

  const table = page.locator("table").first();
  await expect(table.locator("tr", { hasText: "Пятёрочка" })).toBeVisible();
  // Доход — не место.
  await expect(table.locator("tr", { hasText: "ООО Ромашка" })).toHaveCount(0);

  // Подписи колонок целиком.
  const cut = await table.locator("thead th").evaluateAll((ths) =>
    ths.filter((th) => [th, ...th.querySelectorAll("*")].some((el) => el.scrollWidth > el.clientWidth + 1)).length
  );
  expect(cut).toBe(0);

  // Октябрь: «Ресторан» и «Перекрёсток» — впервые, «Пятёрочка» — давно своя.
  const fresh = page.locator(".card-tray", { has: page.getByText("Новые места", { exact: true }) });
  await expect(fresh.getByText("Ресторан")).toBeVisible();
  await expect(fresh.getByText("Перекрёсток")).toBeVisible();
  await expect(fresh.getByText("Пятёрочка")).toHaveCount(0);
  // «Кинопоиск» в октябре ещё не списывался, но раз в месяц — пауза обычная.
  const lost = page.locator(".card-tray", { has: page.getByText("Куда перестали ходить", { exact: true }) });
  await expect(lost.getByText("Все привычные места на месте")).toBeVisible();

  // Полоса долей: половина трат — в первых местах, кусок открывает карточку.
  const share = page.locator(".card-tray", { has: page.getByText("Куда уходят деньги", { exact: true }) });
  await expect(share.getByText(/^Половина трат — в \d+ мест/)).toBeVisible();
  await share.getByRole("button", { name: /^Пятёрочка:/ }).click();
  await expect(page.locator("[data-dossier-title]")).toHaveText("Пятёрочка");
  await expect(page.getByText("Где подорожало", { exact: true })).toBeVisible();

  // Карточка места — по нажатию на строку, за всю историю.
  await table.locator("tr", { hasText: "Кофейня у дома" }).click();
  const title = page.locator("[data-dossier-title]");
  await expect(title).toHaveText("Кофейня у дома");
  const card = page.locator("[data-place-card]");
  await expect(card.getByText("Покупок", { exact: true })).toBeVisible();
  await expect(card.getByText(/^Последний раз /)).toBeVisible();
  await expect(card.locator(".recharts-bar")).toBeVisible();
  await expect(card.getByText("По дням недели")).toBeVisible();
  // График переключается на средний чек.
  await card.getByRole("radio", { name: "Чек" }).or(card.getByRole("button", { name: "Чек", exact: true })).first().click();
  await expect(card.locator(".recharts-bar")).toBeVisible();
  // Выбранная строка отмечена, «Новое» — у мест, впервые появившихся в периоде.
  await expect(table.locator("tr", { hasText: "Ресторан" }).getByText("Новое", { exact: true })).toBeVisible();

  // В карточке ничего не обрезано — ни у одного места таблицы.
  for (const tr of await table.locator("tbody tr").all()) {
    await tr.click();
    const cutInCard = await card.evaluate((el) =>
      [...el.querySelectorAll("*")].filter((e) => e.children.length === 0 && e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent)
    );
    expect(cutInCard).toEqual([]);
  }
  await table.locator("tr", { hasText: "Кофейня у дома" }).click();

  // Подписи оси графика внутри карточки.
  const axisOut = await card.locator("svg.recharts-surface").first().evaluate((svg) => {
    const box = svg.getBoundingClientRect();
    return [...svg.querySelectorAll("text")].filter((t) => t.getBoundingClientRect().left < box.left - 1).length;
  });
  expect(axisOut).toBe(0);

  if (process.env.E2E_SHOTS) await page.screenshot({ path: process.env.E2E_SHOTS + "/counterparties.png", fullPage: true });

  await card.getByRole("button", { name: "Все покупки" }).click();
  await expect(page.getByText("Все покупки").nth(1)).toBeVisible();
});

test("узкое окно: карточка над таблицей, прокрутки вбок нет", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await connectZen(page, "/counterparties");
  const title = page.locator("[data-dossier-title]");
  await expect(title).toBeVisible();
  const [cardTop, tableTop] = await Promise.all([
    title.evaluate((el) => el.getBoundingClientRect().top),
    page.locator("table").first().evaluate((el) => el.getBoundingClientRect().top),
  ]);
  expect(cardTop).toBeLessThan(tableTop);
  expect(await horizontalOverflow(page)).toBe(0);
});

for (const width of [1024, 1280, 1440]) {
  test(`${width} px: в выводах и карточке ничего не обрезано`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await connectZen(page, "/counterparties");
    await expect(page.locator("[data-dossier-title]")).toBeVisible();
    const cut = await page.locator("main").evaluate((main) =>
      [...main.querySelectorAll("*")]
        .filter((e) => e.children.length === 0 && !e.closest("tbody") && e.scrollWidth > e.clientWidth + 1)
        .map((e) => e.textContent)
    );
    expect(cut).toEqual([]);
  });
}
