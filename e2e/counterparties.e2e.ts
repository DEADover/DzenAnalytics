/**
 * «Контрагенты»: места за период, карточка места, новые места, где подорожало.
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
  const fresh = page.locator(".card-tray", { has: page.getByText("Новые контрагенты", { exact: true }) });
  await expect(fresh.getByText("Ресторан")).toBeVisible();
  await expect(fresh.getByText("Перекрёсток")).toBeVisible();
  await expect(fresh.getByText("Пятёрочка")).toHaveCount(0);
  await expect(page.getByText("Куда перестали ходить")).toHaveCount(0);

  // Полоса долей: половина трат — в первых местах, кусок открывает карточку.
  const share = page.locator(".card-tray", { has: page.getByText("Куда уходят деньги", { exact: true }) });
  await expect(share.getByText(/^Половина трат — у \d+ контрагент/)).toBeVisible();
  await share.getByRole("button", { name: /^Пятёрочка:/ }).click();
  await expect(page.locator("[data-dossier-title]")).toHaveText("Пятёрочка");
  await expect(page.getByText("Где подорожало", { exact: true })).toBeVisible();

  // Карточка места — по нажатию на строку, за всю историю.
  await table.locator("tr", { hasText: "Кофейня у дома" }).click();
  const title = page.locator("[data-dossier-title]");
  await expect(title).toHaveText("Кофейня у дома");
  const card = page.locator("[data-place-card]");
  await expect(card.getByText("Операций", { exact: true })).toBeVisible();
  await expect(card.getByText(/^Последний раз /)).toBeVisible();
  await expect(card.locator(".recharts-bar")).toBeVisible();
  await expect(card.getByText("По дням недели")).toBeVisible();
  // Один переключатель на оба графика: дни недели тоже меняются.
  const week = () =>
    card.locator(".grid-cols-7 .rounded-t-\\[3px\\]").evaluateAll((bars) => bars.map((b) => (b as HTMLElement).style.height).join(","));
  const metric = (name: string) =>
    card.getByRole("radio", { name }).or(card.getByRole("button", { name, exact: true })).first().click();
  // Столбики выросли из нуля — анимация появления.
  await expect.poll(async () => (await week()).split(",").some((h) => h !== "0%")).toBe(true);
  const bySum = await week();
  await metric("Операции");
  await expect.poll(week).not.toBe(bySum);
  await metric("Чек");
  await expect(card.locator(".recharts-bar")).toBeVisible();
  // Выбранная строка отмечена, «Новое» — у мест, впервые появившихся в периоде.
  await expect(table.locator("tr", { hasText: "Ресторан" }).getByText("Новый", { exact: true })).toBeVisible();

  // В карточке ничего не обрезано — ни у одного места таблицы.
  for (const tr of await table.locator("tbody tr").all()) {
    await tr.click();
    const cutInCard = await card.evaluate((el) =>
      [...el.querySelectorAll("*")]
        .filter((e) => e.children.length === 0 && !e.hasAttribute("data-dossier-title") && e.scrollWidth > e.clientWidth + 1)
        .map((e) => e.textContent)
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

  await card.getByRole("button", { name: "Все операции" }).click();
  await expect(page.getByText("Все операции").nth(1)).toBeVisible();
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
        // Имя в шапке карточки режется намеренно — полное в подсказке.
        .filter(
          (e) =>
            e.children.length === 0 &&
            !e.closest("tbody") &&
            !e.hasAttribute("data-dossier-title") &&
            e.scrollWidth > e.clientWidth + 1
        )
        .map((e) => e.textContent)
    );
    expect(cut).toEqual([]);
  });
}

test("карточка места в низком окне: целиком в экране, низ докручивается", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 640 });
  await connectZen(page, "/counterparties");
  const card = page.locator("[data-place-card] > .card-tray");
  await expect(card).toBeVisible();
  // Листаем страницу вниз — карточка прилипла и не выше окна.
  await page.locator("tbody tr").last().scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 400);
  const box = await card.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, vh: window.innerHeight, scrollable: el.scrollHeight > el.clientHeight };
  });
  expect(box.bottom).toBeLessThanOrEqual(box.vh);
  expect(box.top).toBeGreaterThanOrEqual(0);
  // Своя прокрутка доводит до последнего блока карточки.
  const reached = await card.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    const last = el.lastElementChild!.getBoundingClientRect();
    return last.bottom <= el.getBoundingClientRect().bottom + 1;
  });
  expect(reached).toBe(true);
  expect(box.scrollable).toBe(true);
});

test("вся история: выводы объясняют, что нужен период, и ставят его кнопкой", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connectZen(page, "/counterparties");
  await page.getByRole("button", { name: "Всё", exact: true }).click();
  const fresh = page.locator(".card-tray", { has: page.getByText("Новые контрагенты", { exact: true }) });
  await expect(fresh.getByText("Нужен период")).toBeVisible();
  // Пояснение — по левому краю, вровень с заголовком карточки.
  const [titleX, textX] = await Promise.all([
    fresh.getByText("Новые контрагенты", { exact: true }).evaluate((el) => el.getBoundingClientRect().left),
    fresh.getByText("Нужен период").evaluate((el) => el.getBoundingClientRect().left),
  ]);
  expect(Math.abs(textX - titleX)).toBeLessThan(40);

  await fresh.getByRole("button", { name: "Показать за последние 12 месяцев" }).click();
  await expect(fresh.getByText("Ресторан")).toBeVisible();
  await expect(page.getByText("Нужен период")).toHaveCount(0);
});

test("новые контрагенты: в блоке все из шапки, лишние листаются внутри", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connectZen(page, "/counterparties");
  await page.getByRole("button", { name: "Всё", exact: true }).click();
  const fresh = page.locator(".card-tray", { has: page.getByText("Новые контрагенты", { exact: true }) });
  await fresh.getByRole("button", { name: "Показать за последние 12 месяцев" }).click();
  const count = Number((await fresh.getByText(/^\d+ контрагент/).textContent())!.match(/^\d+/)![0]);
  await expect(fresh.getByRole("button", { name: /₽$/ })).toHaveCount(count);
  await expect(fresh.getByText(/^Показано/)).toHaveCount(0);
  const list = fresh.locator(".scroll-soft");
  const { scrollable, height } = await list.evaluate((el) => ({
    scrollable: el.scrollHeight > el.clientHeight,
    height: el.clientHeight,
  }));
  // Больше пяти — листается, и блок не выше списка из пяти строк.
  expect(scrollable).toBe(count > 5);
  expect(height).toBeLessThanOrEqual(16.5 * 16 + 1);
});

test("столбики в карточке открывают операции месяца и дня недели", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connectZen(page, "/counterparties");
  await page.locator("table").first().locator("tr", { hasText: "Пятёрочка" }).click();
  const card = page.locator("[data-place-card]");
  // Последний столбик — октябрь, в нём есть операции.
  await card.locator(".recharts-bar-rectangle").last().click();
  await expect(page.getByText(/^Октябрь 2026/)).toBeVisible();
  await page.keyboard.press("Escape");
  await card.getByRole("button", { name: /: показать операции$/ }).and(card.locator(":enabled")).first().click();
  await expect(page.getByText(/· за всё время$/)).toBeVisible();
});

test("число операций в таблице открывает их в боковой панели", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connectZen(page, "/counterparties");
  const row = page.locator("table").first().locator("tr", { hasText: "Пятёрочка" });
  const btn = row.getByRole("button", { name: /^Операции «Пятёрочка» за период: \d+$/ });
  const n = Number((await btn.textContent())!.replace(/\s/g, ""));
  await btn.click();
  await expect(page.getByText("Операции за период")).toBeVisible();
  // В панели ровно столько операций, сколько в ячейке.
  const inDrawer = await page.evaluate(async () => {
    type DrillStore = { useDrillStore: { getState: () => { transactions: unknown[] } } };
    const store = (window as unknown as { __store: (n: string) => Promise<DrillStore> }).__store;
    return (await store("useDrillStore")).useDrillStore.getState().transactions.length;
  });
  expect(inDrawer).toBe(n);
});

test("карточка одной высоты у любого контрагента", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1400 });
  await connectZen(page, "/counterparties");
  await page.getByRole("button", { name: "Всё", exact: true }).click();
  const card = page.locator("[data-place-card] > .card-tray");
  const heights = new Set<number>();
  for (const tr of await page.locator("table").first().locator("tbody tr").all()) {
    await tr.click();
    await page.waitForTimeout(50);
    heights.add(await card.evaluate((el) => Math.round(el.scrollHeight)));
  }
  expect([...heights]).toHaveLength(1);
});
