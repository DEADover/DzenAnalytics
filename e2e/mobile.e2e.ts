/**
 * Узкий экран (375 px — телефон): ни один раздел и ни одно ключевое окно не
 * уезжает вбок. Ловит колонки фиксированной ширины и сетки, раздутые
 * содержимым (#114).
 */
import { test, expect, connectZen, horizontalOverflow } from "./harness";
import { ROUTES } from "./routes";

test.use({ viewport: { width: 375, height: 812 } });

test("все разделы помещаются в ширину телефона", async ({ page }) => {
  test.setTimeout(180_000);
  await connectZen(page);
  const wide: string[] = [];
  for (const route of ROUTES) {
    await page.evaluate((to) => {
      history.pushState(null, "", to);
      dispatchEvent(new PopStateEvent("popstate"));
    }, route);
    await page.waitForTimeout(500);
    const over = await horizontalOverflow(page);
    if (over > 0) wide.push(`${route}: +${over} px`);
  }
  expect(wide, wide.join("\n")).toEqual([]);
});

test("бюджет: «Год» и «Дашборд» тоже", async ({ page }) => {
  await connectZen(page, "/budgets");
  for (const view of ["Год", "Дашборд", "Месяц"]) {
    await page.getByRole("button", { name: view, exact: true }).click();
    await page.waitForTimeout(400);
    expect(await horizontalOverflow(page), view).toBe(0);
  }
});

test("окно правки операции целиком в экране", async ({ page }) => {
  await connectZen(page, "/transactions");
  await page.getByRole("button", { name: "Редактировать операцию" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Сохранить" })).toBeInViewport({ ratio: 1 });
  expect(await dialog.evaluate((d) => d.scrollWidth - d.clientWidth)).toBe(0);
});
