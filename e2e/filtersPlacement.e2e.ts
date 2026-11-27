/**
 * Общие фильтры стоят на одной высоте на всех разделах — и на главной с
 * «Фильтрами и выбором месяца», где у виджетов свой зазор.
 */
import { test, expect, connectZen } from "./harness";

type Win = { __store: (n: string) => Promise<Record<string, { getState: () => Record<string, unknown> }>> };

test("панель фильтров на главной там же, где на «Операциях» и «Счетах»", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page, "/");
  await page.evaluate(async () => {
    const { useDisplayStore } = await (window as unknown as Win).__store("useDisplayStore");
    const display = useDisplayStore.getState() as {
      setHomeFilters: (b: boolean) => Promise<void>;
      setHomePeriodPicker: (b: boolean) => Promise<void>;
    };
    await display.setHomeFilters(true);
    await display.setHomePeriodPicker(true);
  });
  const tops: number[] = [];
  for (const path of ["/", "/transactions", "/accounts"]) {
    await page.evaluate((p) => {
      history.pushState(null, "", p);
      dispatchEvent(new PopStateEvent("popstate"));
    }, path);
    const filters = page.locator('main [data-tour="filters"]').first();
    await expect(filters).toBeVisible();
    await page.waitForTimeout(400);
    tops.push(Math.round((await filters.boundingBox())!.y));
  }
  expect(tops[0]).toBe(tops[1]);
  expect(tops[2]).toBe(tops[1]);
});
