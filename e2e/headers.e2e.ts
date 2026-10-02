/**
 * Подписи столбцов не обрезаются никогда — и с запасом.
 *
 * В таблицах с заданными ширинами подпись, вставшая впритык, на другой машине
 * режется многоточием: шрифт там рисуется на пару пикселей шире («₽
 * ОТКЛОНЕНИ…» при запасе 2 px). Поэтому проверяем не «влезает», а «влезает с
 * запасом ≥ 8 px». Таблицы без заданных ширин подстраиваются сами — их не трогаем.
 */
import { test, expect, connectZen } from "./harness";
import { ROUTES } from "./routes";
import { tightHeaders } from "./tableHeaders";

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
