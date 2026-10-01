/**
 * Вёрстка, которую не проверить расчётами: переносы, ширина, прокрутка вбок.
 */
import { test, expect, connectZen, horizontalOverflow } from "./harness";

test("панель выделения: суммы сверху, все кнопки одним рядом", async ({ page }) => {
  await connectZen(page, "/transactions");
  // Свежие непросмотренные операции — сверху ленты: с ними в панели есть
  // и «Просмотрено», самый длинный набор кнопок.
  const boxes = page.getByRole("checkbox", { name: "Выбрать операцию" });
  for (let i = 0; i < 3; i++) await boxes.nth(i).check();

  const bar = page.getByRole("region", { name: "Массовые действия" });
  await expect(bar.getByText(/^Выбрано:/)).toBeVisible();
  await expect(bar.getByRole("button", { name: /Просмотрено/ })).toBeVisible();

  // Один ряд одной высоты: совпадают и верх, и низ каждой кнопки.
  const edges = await bar.getByRole("button").evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return `${Math.round(r.top)}–${Math.round(r.bottom)}`;
    })
  );
  expect(new Set(edges).size, `кнопки: ${edges.join(", ")}`).toBe(1);
  const box = await bar.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(1440);
});

test.describe("узкий экран", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("«Что, если»: выбранные счета не распирают страницу (#114)", async ({ page }) => {
    await connectZen(page, "/whatif");
    await page.evaluate(async () => {
      type Fire = { useFireStore: { getState: () => { replaceExcluded: (t: string[]) => Promise<void> } } };
      const store = (window as unknown as { __store: (n: string) => Promise<Fire> }).__store;
      const { useFireStore } = await store("useFireStore");
      await useFireStore.getState().replaceExcluded(["Наличные"]);
    });
    await expect(page.getByRole("button", { name: /Т-Банк, Сбер/ })).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
  });
});
