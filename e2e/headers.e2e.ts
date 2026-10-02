/**
 * Подписи столбцов не обрезаются никогда — и с запасом.
 *
 * В таблицах с заданными ширинами подпись, вставшая впритык, на другой машине
 * режется многоточием: шрифт там рисуется на пару пикселей шире («₽
 * ОТКЛОНЕНИ…» при запасе 2 px). Поэтому проверяем не «влезает», а «влезает с
 * запасом ≥ 8 px». Таблицы без заданных ширин подстраиваются сами — их не трогаем.
 */
import type { Page } from "@playwright/test";
import { test, expect, connectZen } from "./harness";
import { ROUTES } from "./routes";

const MIN_SPARE = 8;

async function tightHeaders(page: Page): Promise<string[]> {
  return page.evaluate((minSpare) => {
    const out: string[] = [];
    for (const table of document.querySelectorAll("table")) {
      if (getComputedStyle(table).tableLayout !== "fixed") continue;
      for (const th of table.querySelectorAll("thead th")) {
        const el = th as HTMLElement;
        if (el.offsetWidth === 0 || !el.textContent?.trim()) continue;
        const cs = getComputedStyle(el);
        const avail = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        // Ширина содержимого «как есть» — копией в той же ячейке, тем же шрифтом.
        const probe = document.createElement("div");
        probe.style.cssText = "position:absolute;visibility:hidden;left:0;top:0;width:max-content;white-space:nowrap;";
        for (const ch of [...el.childNodes]) {
          const c = ch.cloneNode(true) as HTMLElement;
          if (c.nodeType === 1) {
            c.style.width = "max-content";
            c.style.maxWidth = "none";
          }
          probe.appendChild(c);
        }
        el.appendChild(probe);
        const need = probe.getBoundingClientRect().width;
        probe.remove();
        if (avail - need < minSpare) out.push(`«${el.textContent.trim()}» запас ${Math.round(avail - need)} px`);
      }
    }
    return out;
  }, MIN_SPARE);
}

test("подписи столбцов во всех разделах — с запасом", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page);
  const tight: string[] = [];
  for (const route of ROUTES) {
    await page.evaluate((to) => {
      history.pushState(null, "", to);
      dispatchEvent(new PopStateEvent("popstate"));
    }, route);
    await page.waitForTimeout(350);
    for (const t of await tightHeaders(page)) tight.push(`${route}: ${t}`);
  }
  // «Полосы» в «Категориях» — со столбцами «Среднее» и «Отклонение».
  await page.evaluate(() => {
    history.pushState(null, "", "/categories");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.getByRole("button", { name: "Полосы" }).click();
  await page.waitForTimeout(400);
  for (const t of await tightHeaders(page)) tight.push(`/categories «Полосы»: ${t}`);
  expect([...new Set(tight)], [...new Set(tight)].join("\n")).toEqual([]);
});
