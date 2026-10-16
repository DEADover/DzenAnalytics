/**
 * «Cash-flow» → вид «Зеркало»: доходы слоями вверх, расходы слоями вниз.
 */
import { test, expect, connectZen, horizontalOverflow } from "./harness";

test("«Зеркало»: слои по сторонам оси, легенда, подсказка и операции месяца", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connectZen(page, "/cashflow");
  const card = page.locator(".card-tray", { has: page.getByRole("radio", { name: "Зеркало" }).or(page.getByRole("button", { name: "Зеркало", exact: true })) }).first();
  await card.getByRole("radio", { name: "Зеркало" }).or(card.getByRole("button", { name: "Зеркало", exact: true })).first().click();
  await expect(card.getByText("Доходы и расходы по категориям", { exact: true })).toBeVisible();
  // Подработки в тестовом аккаунте нет: доход — «Зарплата», расходы — несколько категорий.
  await expect(card.getByText("Зарплата", { exact: true })).toBeVisible();
  const areas = card.locator(".recharts-area");
  await expect.poll(() => areas.count()).toBeGreaterThan(2);

  // Доходы целиком над осью, расходы — под ней: ни один слой не пересекает ноль.
  const crossing = await card.locator("svg.recharts-surface").first().evaluate((svg) => {
    const zero = svg.querySelector(".recharts-reference-line line") as SVGLineElement | null;
    if (!zero) return -1;
    const y0 = zero.getBoundingClientRect().top;
    const areasEls = [...svg.querySelectorAll(".recharts-area")];
    return areasEls.filter((a) => {
      const r = (a.querySelector("path") as SVGPathElement).getBoundingClientRect();
      return r.height > 2 && r.top < y0 - 2 && r.bottom > y0 + 2;
    }).length;
  });
  expect(crossing).toBe(0);

  // Подсказка месяца и операции по нажатию.
  const surface = card.locator("svg.recharts-surface").first();
  const box = (await surface.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect(page.getByText("Итог месяца")).toBeVisible();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  const drill = () =>
    page.evaluate(async () => {
      type S = { useDrillStore: { getState: () => { open: boolean; subtitle?: string; transactions: unknown[] } } };
      const s = (await (window as unknown as { __store: (n: string) => Promise<S> }).__store("useDrillStore")).useDrillStore.getState();
      return { open: s.open, subtitle: s.subtitle, n: s.transactions.length };
    });
  await expect.poll(async () => (await drill()).open).toBe(true);
  const d = await drill();
  expect(d.subtitle).toBe("Месяц");
  expect(d.n).toBeGreaterThan(0);
  expect(await horizontalOverflow(page)).toBe(0);
});
