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

test("«Дубликаты»: кнопка «Не дубликаты (N)» целиком и в одном ряду с бегунком", async ({ page }) => {
  await connectZen(page, "/duplicates");
  // Групп-дублей в подделке нет — исключения заводим прямо в сторе, сразу
  // двузначным числом: так подпись кнопки самая длинная из обычных.
  await page.evaluate(async () => {
    type S = { getState: () => { add: (r: unknown) => Promise<void> } };
    const store = (window as unknown as { __store: (n: string) => Promise<Record<string, S>> }).__store;
    const { useDuplicateExclusionsStore } = await store("useDuplicateExclusionsStore");
    for (let i = 0; i < 12; i++) {
      await useDuplicateExclusionsStore.getState().add({
        signature: `e2e-${i}`,
        payee: `Магазин ${i}`,
        amount: 100 + i,
        currency: "RUB",
        kind: "expense",
        createdAt: "2026-10-15T09:00:00.000Z",
      });
    }
  });
  const open = page.getByRole("button", { name: "Не дубликаты (12)" });
  await expect(open).toBeVisible();

  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    const m = await open.evaluate((b) => {
      const slider = document.querySelector<HTMLElement>('input[type="range"]');
      const r = b.getBoundingClientRect();
      const s = slider?.getBoundingClientRect();
      return {
        clipped: b.scrollWidth > b.clientWidth + 1,
        height: Math.round(r.height),
        // Строки текста — по прямоугольникам самого текста, не по высоте кнопки.
        lines: (() => {
          const tops = new Set<number>();
          const walk = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
          for (let n = walk.nextNode(); n; n = walk.nextNode()) {
            const range = document.createRange();
            range.selectNodeContents(n);
            for (const q of range.getClientRects()) if (q.width > 0) tops.add(Math.round(q.top));
          }
          return tops.size;
        })(),
        sameRow: s ? Math.abs((s.top + s.bottom) / 2 - (r.top + r.bottom) / 2) < r.height / 2 : null,
      };
    });
    expect(m.clipped, `обрезано при ${width}px`).toBe(false);
    expect(m.lines, `перенос текста при ${width}px`).toBeLessThanOrEqual(1);
    expect(m.sameRow, `ряд перенёсся при ${width}px`).toBe(true);
    if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/duplicates-${width}.png` });
  }
});
