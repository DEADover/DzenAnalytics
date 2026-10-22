/**
 * Быстрый поиск в «Операциях» ищет в фильтре или везде. Выбор — подсказкой
 * под полем, пока набирается текст, без кнопок сбоку; «Везде» видно меткой в
 * самом поле.
 */
import { test, expect, connectZen } from "./harness";

for (const width of [1440, 768]) {
  test(`быстрый поиск: подсказка «В фильтре» / «Везде» (${width})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await connectZen(page, "/transactions");

    const field = page.getByPlaceholder("Быстрый поиск по таблице…");
    // Ряд инструментов: сколько в нём строк — не должно меняться от поиска.
    const toolbar = page.locator("[data-search-scope-field]").locator("xpath=..");
    const rowTops = () =>
      toolbar.evaluate((el) => new Set([...el.children].map((c) => Math.round(c.getBoundingClientRect().top))).size);
    const rowsBefore = await rowTops();

    const list = page.getByRole("listbox", { name: "Где искать" });
    await field.fill("Пятёрочка");
    await expect(list).toBeVisible();
    expect(await rowTops()).toBe(rowsBefore);

    const count = async (v: string) =>
      Number(await list.locator(`[data-search-scope='${v}'] [data-count]`).innerText().then((t) => t.replace(/\D/g, "")));
    const nFilter = await count("filter");
    const nAll = await count("all");
    expect(nAll).toBeGreaterThan(nFilter);

    const payees = page.locator("[data-cell='payee']").filter({ hasText: "Пятёрочка" });
    await expect(payees).toHaveCount(nFilter);

    // Стрелка вниз + Enter — «Везде»; в поле появляется метка.
    await field.press("ArrowDown");
    await field.press("Enter");
    await expect(list).toBeHidden();
    const badge = page.locator("[data-search-scope-badge]");
    await expect(badge).toBeVisible();
    await expect.poll(() => payees.count()).toBeGreaterThan(nFilter);
    await expect(page.locator("main")).toContainText(new RegExp(`Операций\\s*${nAll}`));
    expect(await rowTops()).toBe(rowsBefore);

    // Дальнейший набор подсказку не открывает — выбор уже сделан.
    await field.press("End");
    await field.pressSequentially("а");
    await expect(list).toBeHidden();
    await field.press("Backspace");

    // Метка открывает подсказку; щелчок «В фильтре» — обратно.
    await badge.click();
    await expect(list).toBeVisible();
    await list.locator("[data-search-scope='filter']").click();
    await expect(badge).toHaveCount(0);
    await expect(payees).toHaveCount(nFilter);

    // Новый поиск — подсказка снова; Esc прячет её, не трогая выбор.
    await field.fill("");
    await field.fill("Пят");
    await expect(list).toBeVisible();
    await field.press("Escape");
    await expect(list).toBeHidden();
    await expect(field).toHaveValue("Пят");
  });
}
