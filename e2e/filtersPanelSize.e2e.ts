/**
 * Панель общих фильтров не меняет размер, когда фильтр включается: подсветка
 * и счётчик у «Дополнительно» не должны сдвигать страницу ни на пиксель.
 */
import { test, expect, connectZen } from "./harness";

type FiltersWindow = {
  __store: (n: string) => Promise<{ useFiltersStore: { getState: () => Record<string, (...a: unknown[]) => void> } }>;
};

test("включённые фильтры не меняют размер панели", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page, "/transactions");
  const panel = page.locator('[data-tour="filters"]');
  await expect(panel).toBeVisible();
  const size = async () => {
    const b = await panel.boundingBox();
    return `${b?.width}x${b?.height}`;
  };
  const before = await size();

  await page.evaluate(async () => {
    const { useFiltersStore } = await (window as unknown as FiltersWindow).__store("useFiltersStore");
    const st = useFiltersStore.getState();
    st.setOnlyWithComment(true);
    st.setAmountRange(100, 5000);
    st.setSet("categories", new Set(["Дом"]));
    st.setSearch("абв");
  });
  // Счётчик у «Дополнительно» появился — значит, панель уже перерисована.
  await expect(panel.getByTitle("Дополнительные фильтры")).toContainText("2");
  expect(await size()).toBe(before);
});
