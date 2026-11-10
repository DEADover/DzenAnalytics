/**
 * «Без категории» в справочнике категорий: закреплённая первая строка с числом
 * операций и глазом «В аналитике». Глаз правит активный разрез тем же ключом,
 * что и у настоящей категории, — так неразобранные операции выводятся из
 * сводной аналитики.
 */
import { test, expect, connectZen } from "./harness";

test("«Без категории»: первая строка справочника, глаз исключает её из разреза", async ({ page, zen }) => {
  zen.patchFull = (diff) => {
    const base = diff.transaction.find((t) => t.outcome > 0 && t.income === 0)!;
    const bare = [1, 2].map((i) => ({ ...base, id: `bare-${i}`, tag: null, comment: `Без разметки ${i}` }));
    return { ...diff, transaction: [...diff.transaction, ...bare] };
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page, "/settings?tab=operations");
  await page.getByRole("tab", { name: /^Категории/ }).click();

  const row = page.locator("[data-no-category]");
  await expect(row).toBeVisible();
  await expect(row).toContainText("Без категории");
  await expect(row.getByRole("button", { name: "2" })).toBeVisible();
  // Первая строка списка — над всеми категориями Дзен-мани.
  const first = page.locator(".list-head + div > div").first();
  await expect(first).toHaveAttribute("data-no-category");

  await row.getByRole("button", { name: "Исключить операции без категории из аналитики" }).click();
  await expect(row.getByRole("button", { name: "Вернуть операции без категории в аналитику" })).toHaveAttribute("aria-pressed", "true");
  const excluded = await page.evaluate(async () => {
    type S = { useSlicesStore: { getState: () => { slices: { id: string; excludedCategories: string[] }[]; activeId: string } } };
    const { useSlicesStore } = await (window as unknown as { __store: (n: string) => Promise<S> }).__store("useSlicesStore");
    const st = useSlicesStore.getState();
    return st.slices.find((s) => s.id === st.activeId)!.excludedCategories;
  });
  expect(excluded).toEqual(["Без категории"]);
  if (process.env.E2E_SHOTS)
    await page.screenshot({ path: `${process.env.E2E_SHOTS}/no-category-row.png`, clip: { x: 0, y: 0, width: 1440, height: 520 } });

  // Поиск по другой категории прячет строку, по её названию — оставляет.
  const search = page.locator("[data-sticky-toolbar] input").first();
  await search.fill("Кафе");
  await expect(row).toHaveCount(0);
  await search.fill("без кат");
  await expect(row).toBeVisible();
});
