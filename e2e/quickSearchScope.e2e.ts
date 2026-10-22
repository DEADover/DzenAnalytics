/**
 * Быстрый поиск в «Операциях» ищет в фильтре или везде: переключатель
 * появляется с текстом в поле и показывает, сколько найдётся в каждом случае.
 */
import { test, expect, connectZen } from "./harness";

for (const width of [1440, 1280, 768]) {
  test(`быстрый поиск: «В фильтре» и «Везде» (${width})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await connectZen(page, "/transactions");

    const scope = page.getByRole("group", { name: "Где искать" });
    await expect(scope).toHaveCount(0);

    await page.getByPlaceholder("Быстрый поиск по таблице…").fill("Пятёрочка");
    await expect(scope).toBeVisible();
    const inFilter = scope.getByRole("button", { name: /В фильтре/ });
    const everywhere = scope.getByRole("button", { name: /Везде/ });
    const count = async (b: typeof inFilter) => Number((await b.innerText()).replace(/\D+/g, ""));
    const nFilter = await count(inFilter);
    const nAll = await count(everywhere);
    // Отчётный месяц — октябрь, а «Пятёрочка» есть и в прошлых месяцах.
    expect(nAll).toBeGreaterThan(nFilter);

    const payees = page.locator("[data-cell='payee']").filter({ hasText: "Пятёрочка" });
    await expect(payees).toHaveCount(nFilter);

    await everywhere.click();
    await expect(page.locator("main")).toContainText(new RegExp(`Операций\\s*${nAll}`));
    await expect.poll(() => payees.count()).toBeGreaterThan(nFilter);

    // Ряд инструментов — в одну строку, подписи не обрезаны.
    const toolbar = scope.locator("xpath=..");
    const tops = await toolbar.evaluate((el) =>
      [...el.children].map((c) => Math.round((c as HTMLElement).getBoundingClientRect().top))
    );
    // На планшетной ширине переключатель переносит кнопки на вторую строку —
    // места не хватает; на экранах компьютеров ряд один.
    if (width >= 1280) expect(new Set(tops).size).toBe(1);
    for (const b of [inFilter, everywhere]) {
      expect(await b.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }

    // Очистили поле — переключатель ушёл, лента снова по фильтру.
    await page.getByPlaceholder("Быстрый поиск по таблице…").fill("");
    await expect(scope).toHaveCount(0);
  });
}
