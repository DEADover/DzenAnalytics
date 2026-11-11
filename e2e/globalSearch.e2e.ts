/**
 * Поиск в общих фильтрах: поле отвечает на каждую букву, а в общий фильтр
 * набранное уходит после паузы — запись туда пересчитывает все разделы.
 */
import type { Page } from "@playwright/test";
import { test, expect, connectZen } from "./harness";

const storeSearch = (page: Page) =>
  page.evaluate(async () => {
    type S = { useFiltersStore: { getState: () => { search: string } } };
    const { useFiltersStore } = await (window as unknown as { __store: (n: string) => Promise<S> }).__store("useFiltersStore");
    return useFiltersStore.getState().search;
  });

test("набор уходит в фильтр после паузы, лента сужается, крестик очищает сразу", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page, "/transactions");
  const field = page.getByPlaceholder("Фильтр: получатель, комментарий");
  await field.pressSequentially("Пятёр", { delay: 20 });
  await expect(field).toHaveValue("Пятёр");
  await expect.poll(() => storeSearch(page)).toBe("Пятёр");
  const rows = page.locator(".op-row");
  await expect.poll(() => rows.count()).toBeGreaterThan(0);
  for (const text of await rows.allInnerTexts()) expect(text).toContain("Пятёрочка");

  await field.locator("xpath=..").getByRole("button").click();
  await expect(field).toHaveValue("");
  expect(await storeSearch(page)).toBe("");
});

test("сброс снаружи (сохранённый вид, «Сбросить») сразу виден в поле", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page, "/transactions");
  const field = page.getByPlaceholder("Фильтр: получатель, комментарий");
  await field.fill("Кофейня");
  await expect.poll(() => storeSearch(page)).toBe("Кофейня");
  await page.evaluate(async () => {
    type S = { useFiltersStore: { getState: () => { setSearch: (v: string) => void } } };
    const { useFiltersStore } = await (window as unknown as { __store: (n: string) => Promise<S> }).__store("useFiltersStore");
    useFiltersStore.getState().setSearch("Ресторан");
  });
  await expect(field).toHaveValue("Ресторан");
});
