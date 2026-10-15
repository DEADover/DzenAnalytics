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

  // Карточка места — по нажатию на строку, за всю историю.
  await table.locator("tr", { hasText: "Кофейня у дома" }).click();
  const title = page.locator("[data-dossier-title]");
  await expect(title).toHaveText("Кофейня у дома");
  const card = page.locator(".card-tray", { has: title });
  await expect(card.getByText("Как часто")).toBeVisible();
  await expect(card.getByText("Впервые")).toBeVisible();
  await expect(card.locator(".recharts-bar")).toBeVisible();

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
