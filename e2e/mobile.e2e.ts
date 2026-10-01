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

test("лента: в строке видны категория, контрагент и сумма", async ({ page }) => {
  await connectZen(page, "/transactions");
  const row = page.locator(".op-row", { hasText: "Перекрёсток" }).first();
  await expect(row.getByText("Продукты")).toBeVisible();
  await expect(row.getByText("Перекрёсток")).toBeVisible();
  await expect(row.getByText(/2\s340/)).toBeVisible();
  // Категории хватает места: не схлопнута до одного значка.
  const w = await row.locator('[data-cell="category"]').evaluate((e) => e.getBoundingClientRect().width);
  expect(w).toBeGreaterThan(120);
});

test("таблицы: колонка названий не схлопывается", async ({ page }) => {
  await connectZen(page, "/top");
  const head = page.locator("table thead th").first();
  await head.scrollIntoViewIfNeeded();
  expect(await head.evaluate((e) => e.getBoundingClientRect().width)).toBeGreaterThan(100);
  await expect(page.locator("table tbody tr").first().getByText("Дом")).toBeVisible();
});

test("окна разделения и создания — целиком в экране", async ({ page }) => {
  await connectZen(page, "/transactions");
  await page.getByRole("button", { name: "Редактировать операцию" }).nth(2).click();
  await page.getByRole("dialog").getByRole("button", { name: "Разделить операцию" }).click();
  const split = page.getByRole("dialog");
  await expect(split.getByLabel("Сумма части 1")).toBeInViewport({ ratio: 1 });
  expect(await split.evaluate((d) => d.scrollWidth - d.clientWidth)).toBe(0);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: /Добавить/ }).first().click();
  await page.getByRole("menuitem").first().click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Создать", exact: true })).toBeInViewport({ ratio: 1 });
});

test("счета: название и остаток видны без прокрутки", async ({ page }) => {
  await connectZen(page, "/accounts");
  const row = page.locator("table.acc-table tbody tr", { hasText: "Т-Банк" }).first();
  await row.scrollIntoViewIfNeeded();
  await expect(row.getByText("Т-Банк")).toBeInViewport({ ratio: 1 });
  // Ячейка шире экрана, а нужен сам текст суммы — меряем его.
  const right = await row.getByText(/84\s250/).evaluate((td) => {
    const range = document.createRange();
    range.selectNodeContents(td);
    return range.getBoundingClientRect().right;
  });
  expect(right).toBeLessThanOrEqual(375);
});
