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

test("условия в текстовом поиске: «-слово», «комм:пусто», «комм:есть» (#135)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page, "/transactions");
  const panel = page.locator('[data-tour="filters"]');
  await expect(panel).toBeVisible();

  // Счёт по самим данным: период — всё время, чтобы числа были не мелкими.
  const facts = await page.evaluate(async () => {
    const w = window as unknown as {
      __store: (n: string) => Promise<Record<string, { getState: () => Record<string, unknown> }>>;
    };
    const { useDataStore } = await w.__store("useDataStore");
    const { useFiltersStore } = await w.__store("useFiltersStore");
    (useFiltersStore.getState().setPreset as (p: string) => void)("all");
    const txs = useDataStore.getState().transactions as { comment?: string }[];
    const filled = txs.filter((t) => (t.comment ?? "").trim()).length;
    const word = txs.map((t) => (t.comment ?? "").trim().split(/\s+/)[0]).find((x) => x.length > 3) ?? "";
    return { total: txs.length, filled, word };
  });
  expect(facts.word).not.toBe("");
  expect(facts.filled).toBeGreaterThan(0);

  /** Сколько операций прошло общий фильтр — по самому стору, как считает лента. */
  const passed = () =>
    page.evaluate(async () => {
      const w = window as unknown as {
        __store: (n: string) => Promise<Record<string, unknown>>;
      };
      const { useDataStore } = (await w.__store("useDataStore")) as {
        useDataStore: { getState: () => { transactions: unknown[] } };
      };
      const mod = (await w.__store("useFiltersStore")) as {
        useFiltersStore: { getState: () => unknown };
        applyFilters: (t: unknown[], f: unknown, d: number) => unknown[];
      };
      return mod.applyFilters(useDataStore.getState().transactions, mod.useFiltersStore.getState(), 1).length;
    });

  const field = panel.getByPlaceholder(/Фильтр: получатель/);
  await field.fill("комм:есть");
  await expect.poll(passed).toBe(facts.filled);
  await field.fill("комм:пусто");
  await expect.poll(passed).toBe(facts.total - facts.filled);

  // Быстрый поиск по таблице понимает те же условия: слово есть — «-слово» его прячет.
  await field.fill("");
  const quick = page.getByPlaceholder("Быстрый поиск по таблице…");
  await quick.fill(`комм:${facts.word}`);
  const rows = page.locator(".op-row").filter({ hasText: new RegExp(facts.word, "i") });
  await expect(rows.first()).toBeVisible();
  await quick.fill(`комм:${facts.word} -${facts.word}`);
  await expect(page.locator(".op-row").filter({ hasText: new RegExp(facts.word, "i") })).toHaveCount(0);
});
