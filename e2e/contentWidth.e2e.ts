/**
 * «Ширина сервиса» (Настройки → Оформление): на широком экране шапка, панель
 * фильтров и страница встают колонкой по центру, а подложки остаются во всю
 * ширину. На экране уже колонки не меняется ничего.
 */
import { test, expect, connectZen, horizontalOverflow } from "./harness";
import type { Page } from "@playwright/test";

const LIMIT = 1600;

async function setContentWidth(page: Page, width: number) {
  await page.evaluate(async (w) => {
    type Display = { useDisplayStore: { getState: () => { setContentWidth: (w: number) => Promise<void> } } };
    const store = (window as unknown as { __store: (n: string) => Promise<Display> }).__store;
    const { useDisplayStore } = await store("useDisplayStore");
    await useDisplayStore.getState().setContentWidth(w);
  }, width);
}

/** Края колонки: где начинается и кончается содержимое шапки и страницы. */
async function measure(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const row = document.querySelector(".app-header") as HTMLElement;
    const main = document.querySelector("main") as HTMLElement;
    const kids = [...row.children].filter((c) => (c as HTMLElement).offsetWidth > 0);
    const rects = kids.map((c) => c.getBoundingClientRect());
    const mainRect = main.getBoundingClientRect();
    const ms = getComputedStyle(main);
    const blocks = [...main.querySelectorAll(":scope > *")]
      .map((c) => c.getBoundingClientRect())
      .filter((r) => r.width > 0);
    return {
      vw,
      rowLeft: Math.round(row.getBoundingClientRect().left),
      rowWidth: Math.round(row.getBoundingClientRect().width),
      headLeft: Math.round(Math.min(...rects.map((r) => r.left))),
      headRight: Math.round(Math.max(...rects.map((r) => r.right))),
      mainLeft: Math.round(mainRect.left + parseFloat(ms.paddingLeft)),
      mainRight: Math.round(mainRect.right - parseFloat(ms.paddingRight)),
      blocksLeft: Math.round(Math.min(...blocks.map((r) => r.left))),
      blocksRight: Math.round(Math.max(...blocks.map((r) => r.right))),
    };
  });
}

test("ширина сервиса: колонка по центру широкого экрана, подложка шапки во всю ширину", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1200 });
  await connectZen(page, "/transactions");

  const full = await measure(page);
  // Во весь экран (по умолчанию) содержимое тянется почти до краёв.
  expect(full.mainRight - full.mainLeft).toBeGreaterThan(LIMIT);

  await setContentWidth(page, LIMIT);
  await expect.poll(async () => {
    const r = await measure(page);
    return r.mainRight - r.mainLeft;
  }).toBeLessThan(LIMIT);
  const m = await measure(page);
  const colLeft = (m.vw - LIMIT) / 2;
  const colRight = colLeft + LIMIT;

  // Подложка шапки — во всю ширину окна.
  expect(m.rowLeft).toBe(0);
  expect(m.rowWidth).toBe(m.vw);

  // Страница: не шире колонки и по центру.
  expect(m.mainRight - m.mainLeft).toBeLessThanOrEqual(LIMIT);
  expect(m.mainLeft).toBeGreaterThanOrEqual(colLeft);
  expect(m.mainRight).toBeLessThanOrEqual(colRight);
  expect(Math.abs(m.mainLeft - (m.vw - m.mainRight))).toBeLessThanOrEqual(1);
  expect(m.blocksLeft).toBeGreaterThanOrEqual(m.mainLeft);
  expect(m.blocksRight).toBeLessThanOrEqual(m.mainRight);

  // Шапка: содержимое в той же колонке, края совпадают со страницей.
  expect(m.headLeft).toBeGreaterThanOrEqual(colLeft);
  expect(m.headRight).toBeLessThanOrEqual(colRight);
  expect(Math.abs(m.headLeft - m.mainLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(m.headRight - m.mainRight)).toBeLessThanOrEqual(1);

  expect(await horizontalOverflow(page)).toBe(0);

  // «Наверх» — в углу колонки, а не экрана.
  await page.evaluate(() => {
    const spacer = document.createElement("div");
    spacer.style.height = "4000px";
    document.querySelector("main")!.append(spacer);
    window.scrollTo({ top: 2000, behavior: "instant" });
    window.dispatchEvent(new Event("scroll"));
  });
  const up = page.getByRole("button", { name: "Вернуться к началу списка" });
  await expect(up).toBeVisible();
  const upBox = (await up.boundingBox())!;
  expect(upBox.x + upBox.width).toBeLessThanOrEqual(colRight);
  expect(upBox.x + upBox.width).toBeGreaterThan(colRight - 48);
});

test("ширина сервиса: панель фильтров по кнопке — в той же колонке", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1200 });
  await connectZen(page, "/transactions");
  await page.evaluate(async () => {
    type Display = { useDisplayStore: { getState: () => { setFiltersMode: (m: string) => Promise<void> } } };
    const store = (window as unknown as { __store: (n: string) => Promise<Display> }).__store;
    const { useDisplayStore } = await store("useDisplayStore");
    await useDisplayStore.getState().setFiltersMode("button");
  });
  await setContentWidth(page, LIMIT);
  await page.getByRole("button", { name: "Показать фильтры" }).click();

  // Панель — второй ярус шапки: то же стекло, но не строка шапки.
  const panel = page.locator("header .glass.app-gutter:not(.app-header)");
  await expect(panel).toBeVisible();
  const r = await panel.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return {
      left: Math.round(box.left),
      width: Math.round(box.width),
      contentLeft: Math.round(box.left + parseFloat(s.paddingLeft)),
      contentRight: Math.round(box.right - parseFloat(s.paddingRight)),
      vw: document.documentElement.clientWidth,
    };
  });
  const colLeft = (r.vw - LIMIT) / 2;
  // Стекло — во всю ширину, содержимое — колонкой.
  expect(r.left).toBe(0);
  expect(r.width).toBe(r.vw);
  expect(r.contentLeft).toBeGreaterThanOrEqual(colLeft);
  expect(r.contentRight).toBeLessThanOrEqual(colLeft + LIMIT);
});

test("ширина сервиса: на экране уже колонки ничего не меняется", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page, "/transactions");
  const before = await measure(page);
  await setContentWidth(page, LIMIT);
  const after = await measure(page);
  expect(after).toEqual(before);
  // Прежние поля страницы — 24 px при ширине от 768.
  expect(after.mainLeft).toBe(24);
  expect(after.vw - after.mainRight).toBe(24);
});

test("ширина сервиса: настройка в «Оформлении» — бегунок как у размера текста таблиц", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1200 });
  await connectZen(page, "/settings?tab=interface");

  const contentMax = () => page.evaluate(() => document.documentElement.style.getPropertyValue("--content-max"));
  const slider = page.getByRole("slider", { name: "Ширина сервиса", exact: true });
  const fontSlider = page.getByRole("slider", { name: "Размер текста в таблицах", exact: true });
  await expect(slider).toBeVisible();

  // По умолчанию — во весь экран: бегунок в крайнем правом положении.
  await expect(slider).toHaveAttribute("aria-valuetext", "Во весь экран");
  expect(await slider.evaluate((el: HTMLInputElement) => el.value === el.max)).toBe(true);
  expect(await contentMax()).toBe("100%");

  // С клавиатуры: Home — самая узкая колонка, четыре шага вправо — 1600.
  await slider.focus();
  await slider.press("Home");
  for (let i = 0; i < 4; i++) await slider.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuetext", /^1\s600 px$/);
  await expect(page.getByText(/^1\s600 px — колонкой по центру экрана$/)).toBeVisible();
  await expect.poll(contentMax).toBe("1600px");

  // Та же строка, что у размера текста таблиц: дорожка той же ширины и на
  // той же вертикали — контролы встают ровной колонкой у правого края.
  const box = (await slider.boundingBox())!;
  const fontBox = (await fontSlider.boundingBox())!;
  expect(Math.round(box.width)).toBe(Math.round(fontBox.width));
  expect(Math.abs(box.x + box.width - (fontBox.x + fontBox.width))).toBeLessThanOrEqual(24);

  // End — снова во весь экран.
  await slider.press("End");
  await expect(slider).toHaveAttribute("aria-valuetext", "Во весь экран");
  await expect.poll(contentMax).toBe("100%");

  // Строка стоит прямо перед «Размером текста в таблицах».
  expect(box.y).toBeLessThan(fontBox.y);

  // Перетаскивание: пока бегунок держат, сервис на месте, видны направляющие;
  // отпустили — ширина применилась, направляющих нет.
  // Дождаться конца плавной смены кадров после End: пока она идёт, страница
  // закрыта снимком и мышь до бегунка не доходит.
  await page.waitForTimeout(500);
  const b = (await slider.boundingBox())!;
  const guide = page.locator("[data-content-width-guide]");
  await page.mouse.move(b.x + b.width - 4, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 6, b.y + b.height / 2, { steps: 8 });
  await expect(guide).toBeVisible();
  expect(await contentMax()).toBe("100%");
  await page.mouse.up();
  await expect(guide).toHaveCount(0);
  await expect.poll(contentMax).toBe("1280px");
});
