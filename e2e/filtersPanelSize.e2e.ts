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

test("«Комментарий не содержит» прячет операции со словом (#135)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page, "/transactions");
  const panel = page.locator('[data-tour="filters"]');
  await expect(panel).toBeVisible();

  // Слово из комментария первой попавшейся операции; период — всё время.
  const word = await page.evaluate(async () => {
    const w = window as unknown as {
      __store: (n: string) => Promise<Record<string, { getState: () => Record<string, unknown> }>>;
    };
    const { useDataStore } = await w.__store("useDataStore");
    const { useFiltersStore } = await w.__store("useFiltersStore");
    (useFiltersStore.getState().setPreset as (p: string) => void)("all");
    const txs = useDataStore.getState().transactions as { comment?: string }[];
    const found = txs.map((t) => (t.comment ?? "").trim().split(/\s+/)[0]).find((x) => x.length > 3);
    return found ?? "";
  });
  expect(word).not.toBe("");

  // Обычный фильтр находит операции с этим словом…
  await panel.getByPlaceholder(/Фильтр: получатель/).fill(word);
  const hits = page.getByText(new RegExp(word, "i"));
  await expect(hits.first()).toBeVisible();

  // …а «Не содержит» с тем же словом убирает их все.
  await panel.getByTitle("Дополнительные фильтры").click();
  await page.getByPlaceholder("Не содержит слов…").fill(word);
  await expect(panel.getByTitle("Дополнительные фильтры")).toContainText("1");
  await page.keyboard.press("Escape");
  await expect(page.locator("main").getByText(new RegExp(word, "i"))).toHaveCount(0);
});
