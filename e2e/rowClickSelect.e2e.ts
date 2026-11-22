/**
 * «Выделение строки кликом» (Настройки → Оформление): выключено — одиночный
 * клик по строке операции её не отмечает; галочка и двойной клик
 * работают как раньше.
 */
import { test, expect, connectZen, readMeta } from "./harness";

test("выключили «Выделение строки кликом» — клик не отмечает, галочка и двойной клик работают", async ({ page }) => {
  await connectZen(page, "/settings?tab=interface");
  const sw = page.getByRole("switch", { name: "Выделение строки кликом" });
  await expect(sw).toBeChecked();
  await sw.click();
  await expect(sw).not.toBeChecked();
  // Перезагрузка ниже — настройка должна успеть лечь в базу.
  await expect
    .poll(async () => (await readMeta<{ rowClickSelect?: boolean }>(page, "displaySettings"))?.rowClickSelect)
    .toBe(false);

  await page.goto("/transactions");
  const row = page.locator(".op-row").nth(1);
  const bar = page.getByRole("region", { name: "Массовые действия" });
  await row.locator("[data-cell]").last().click();
  // Отложенное выделение ждёт порог двойного клика — даём ему время.
  await page.waitForTimeout(400);
  await expect(bar).toHaveCount(0);
  await expect(row).not.toHaveClass(/bg-accent\/5/);

  // Галочка отмечает.
  await row.getByRole("checkbox", { name: "Выбрать операцию" }).check();
  await expect(bar.getByText(/^Выбрано:/)).toBeVisible();
  await row.getByRole("checkbox", { name: "Выбрать операцию" }).uncheck();

  // Двойной клик открывает операцию.
  await row.locator("[data-cell]").last().dblclick();
  await expect(page.getByRole("dialog").filter({ hasText: "Редактирование операции" })).toBeVisible();
});

test("по умолчанию клик по строке отмечает её", async ({ page }) => {
  await connectZen(page, "/transactions");
  const row = page.locator(".op-row").nth(1);
  await row.locator("[data-cell]").last().click();
  await expect(page.getByRole("region", { name: "Массовые действия" }).getByText(/^Выбрано:/)).toBeVisible();
});

test("Shift: диапазон строк галочками и кликом по строке (#143)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connectZen(page, "/transactions");
  const boxes = page.getByRole("checkbox", { name: "Выбрать операцию" });
  await expect(boxes.nth(6)).toBeVisible();
  const on = () => boxes.evaluateAll((els) => els.flatMap((e, i) => ((e as HTMLInputElement).checked ? [i] : [])));

  // Галочка, затем Shift + галочка — вниз.
  await boxes.nth(1).click();
  await boxes.nth(4).click({ modifiers: ["Shift"] });
  await expect.poll(on).toEqual([1, 2, 3, 4]);
  // Текст на странице при этом не выделился.
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");

  // Shift по отмеченной — снимает диапазон от прошлой точки.
  await boxes.nth(2).click({ modifiers: ["Shift"] });
  await expect.poll(on).toEqual([1]);

  // Вверх и кликом по самой строке.
  await page.keyboard.press("Escape");
  await expect.poll(on).toEqual([]);
  const rows = page.locator(".op-row");
  await rows.nth(5).locator('[data-cell="payee"]').click();
  await expect.poll(on).toEqual([5]);
  await rows.nth(3).locator('[data-cell="payee"]').click({ modifiers: ["Shift"] });
  await expect.poll(on).toEqual([3, 4, 5]);
  await expect(page.locator("[data-exit-panel]")).toHaveCount(0);
});

test("Shift в таблице шторки операций (#143)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connectZen(page, "/");
  await page.evaluate(async () => {
    type S = { getState: () => { setHidden: (k: string, h: boolean) => Promise<void> } };
    const w = window as unknown as { __store: (n: string) => Promise<Record<string, S>> };
    const { useDashboardLayoutStore } = await w.__store("useDashboardLayoutStore");
    await useDashboardLayoutStore.getState().setHidden("pace", false);
  });
  await page.locator('[data-tour="widget-pace"]').getByTestId("pace-categories").getByRole("button", { name: /Продукты/ }).click();
  const drawer = page.locator("[data-exit-panel]");
  const boxes = drawer.getByRole("checkbox", { name: "Выбрать строку" });
  await expect(boxes.nth(4)).toBeVisible();
  const on = () => boxes.evaluateAll((els) => els.flatMap((e, i) => ((e as HTMLInputElement).checked ? [i] : [])));
  await boxes.nth(3).click();
  await boxes.nth(1).click({ modifiers: ["Shift"] });
  await expect.poll(on).toEqual([1, 2, 3]);
});
