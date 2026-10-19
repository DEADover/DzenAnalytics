/**
 * Меню множественного выбора (фильтр «Счета»): найденное показывается целиком,
 * без своей прокрутки, — заголовки групп входят в высоту меню (#123).
 */
import { test, expect, connectZen } from "./harness";

test("поиск счёта: меню с найденным не обрезано", async ({ page, zen }) => {
  // Поиск в меню появляется, когда вариантов больше восьми.
  zen.patchFull = (diff) => ({
    ...diff,
    account: [
      ...diff.account,
      ...Array.from({ length: 10 }, (_, i) => ({ ...diff.account[0], id: `acc-extra-${i}`, title: `Карта ${i + 1}` })),
    ],
  });
  await connectZen(page, "/transactions");
  await page.getByRole("button", { name: /^Счета:/ }).first().click();
  const search = page.getByPlaceholder("Поиск счёта");
  const menu = search.locator("xpath=ancestor::div[contains(@class,'fixed')][1]");
  const overflow = () => menu.evaluate((el) => el.scrollHeight - el.clientHeight);

  await search.fill("сбер");
  await expect(menu.getByText("Сбер", { exact: true })).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(1);
  // Набрано не в той раскладке («c,th» = «сбер») — найдено то же, и тоже целиком.
  await search.fill("c,th");
  await expect(menu.getByText("Сбер", { exact: true })).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(1);
});
