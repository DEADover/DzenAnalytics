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

test("ширина сервиса: настройка в «Оформлении» — переключатель и бегунок одним рядом", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1200 });
  await connectZen(page, "/settings?tab=interface");

  const group = page.getByRole("group", { name: "Ширина сервиса", exact: true });
  await expect(group).toBeVisible();
  // Ряд контрола: капсула бегунка (когда ширина ограничена) и переключатель.
  const row = group.locator("xpath=..");
  await group.getByRole("button", { name: "Ограничить" }).click();

  const slider = page.getByRole("slider", { name: "Ширина", exact: true });
  await expect(slider).toBeVisible();
  await expect(page.getByText(/Не шире 1\s920 px — колонкой по центру экрана/)).toBeVisible();

  // Бегунок с клавиатуры: четыре шага влево — 1600.
  await slider.focus();
  for (let i = 0; i < 4; i++) await slider.press("ArrowLeft");
  await expect(page.getByText(/Не шире 1\s600 px/)).toBeVisible();
  const css = await page.evaluate(() => document.documentElement.style.getPropertyValue("--content-max"));
  expect(css).toBe("1600px");

  // Капсула бегунка и переключатель — одной высоты, в одну строку, подписи целиком.
  const boxes = await row.evaluate((el) =>
    [...el.children].map((c) => {
      const r = c.getBoundingClientRect();
      return { top: Math.round(r.top), h: Math.round(r.height) };
    })
  );
  expect(boxes.length).toBe(2);
  expect(new Set(boxes.map((b) => b.top)).size).toBe(1);
  expect(new Set(boxes.map((b) => b.h)).size).toBe(1);
  const cut = await row.locator("label, output, button").evaluateAll((els) =>
    els.some((e) => e.scrollWidth > e.clientWidth + 1)
  );
  expect(cut).toBe(false);

  // «Во весь экран» — прежний вид; «Ограничить» возвращает последнюю ширину.
  await group.getByRole("button", { name: "Во весь экран" }).click();
  await expect(slider).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--content-max"))).toBe("100%");
  await group.getByRole("button", { name: "Ограничить" }).click();
  await expect(page.getByText(/Не шире 1\s600 px/)).toBeVisible();
});
