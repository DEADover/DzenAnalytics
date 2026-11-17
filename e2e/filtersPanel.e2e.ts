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

test("условия в текстовом поиске: «-слово», «комм:нет», «комм:есть» (#135)", async ({ page }) => {
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
  await field.fill("комм:нет");
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

test("поле поиска: Tab дописывает «комм:», условие подсвечено, памятка по знаку вопроса (#135)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page, "/transactions");
  const panel = page.locator('[data-tour="filters"]');
  await expect(panel).toBeVisible();
  const before = await panel.boundingBox();

  for (const field of [
    panel.getByPlaceholder(/Фильтр: получатель/),
    page.getByPlaceholder("Быстрый поиск по таблице…"),
  ]) {
    await field.click();
    await field.pressSequentially("аптека -комм");
    const wrap = field.locator("xpath=..");
    await expect(wrap.locator("[data-syntax-suggest]")).toContainText("Искать в комментарии");
    await page.keyboard.press("Tab");
    await expect(field).toHaveValue("аптека -комм:");
    await expect(field).toBeFocused();
    await expect(wrap.locator("[data-syntax-op]")).toHaveText("-комм:");
    await field.fill("");
    // Обычный текст слой не включает, и Tab остаётся обычным переходом.
    await field.pressSequentially("коммуналка");
    await expect(wrap.locator("[data-syntax-layer]")).toHaveCount(0);
    await field.fill("");
  }

  // Знак вопроса в поле открывает памятку.
  await panel.getByRole("button", { name: "Как искать" }).click();
  await expect(page.getByRole("dialog", { name: "Как искать" })).toContainText("комм:нет");
  await page.keyboard.press("Escape");
  // Высота панели от знака вопроса не изменилась.
  expect((await panel.boundingBox())?.height).toBe(before?.height);
});

test("поиск: условия по сумме, счёту и категории", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page, "/transactions");
  const quick = page.getByPlaceholder("Быстрый поиск по таблице…");
  const rows = page.locator(".op-row");
  const amounts = async () =>
    (await rows.locator('[data-cell="amount"]').allTextContents()).map((t) =>
      Number(t.replace(/[^\d,]/g, "").replace(",", "."))
    );

  // Сумма: все найденные строки больше порога. Список перестраивается чуть
  // позже набора (отложенный поиск), поэтому ждём условие, а не первую строку.
  await quick.fill("сумма:>9000");
  await expect
    .poll(async () => {
      const a = await amounts();
      return a.length > 0 && a.every((v) => v > 9000);
    })
    .toBe(true);
  // Диапазон.
  await quick.fill("сумма:8000-9500");
  await expect
    .poll(async () => {
      const a = await amounts();
      return a.length > 0 && a.every((v) => v >= 8000 && v <= 9500);
    })
    .toBe(true);

  // Категория и счёт сочетаются с суммой.
  await quick.fill("кат:вне сумма:9000");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Ресторан");
  await quick.fill("кат:вне сумма:9000 -счёт:сбер");
  await expect(rows).toHaveCount(0);

  // Tab дописывает условие, подсказка говорит, что писать дальше.
  await quick.fill("");
  await quick.click();
  await quick.pressSequentially("кофе сумм");
  const wrap = quick.locator("xpath=..");
  await expect(wrap.locator("[data-syntax-suggest]")).toContainText("Искать по сумме");
  await page.keyboard.press("Tab");
  await expect(quick).toHaveValue("кофе сумма:");
  await expect(wrap.locator("[data-syntax-values]")).toContainText(">5000, <100 или 1000-5000");
  await expect(wrap.locator("[data-syntax-op]")).toHaveText("сумма:");
});

test("поиск: Tab дописывает название счёта и категории", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page, "/transactions");
  const quick = page.getByPlaceholder("Быстрый поиск по таблице…");
  const wrap = quick.locator("xpath=..");
  const rows = page.locator(".op-row");

  // Категория из нескольких слов подставляется в кавычках и сразу отбирает.
  await quick.click();
  await quick.pressSequentially("кат:вне");
  await expect(wrap.locator("[data-syntax-suggest]")).toContainText("Еда вне дома");
  await page.keyboard.press("Tab");
  await expect(quick).toHaveValue('кат:"Еда вне дома"');
  await expect(quick).toBeFocused();
  await expect(rows.first()).toContainText("Еда вне дома");

  // Счёт — тем же приёмом, вместе с минусом.
  await quick.pressSequentially(" -счёт:сб");
  await expect(wrap.locator("[data-syntax-suggest]")).toContainText("Сбер");
  await page.keyboard.press("Tab");
  await expect(quick).toHaveValue('кат:"Еда вне дома" -счёт:Сбер');

  // То же поле общего фильтра.
  await quick.fill("");
  const field = page.locator('[data-tour="filters"]').getByPlaceholder(/Фильтр: получатель/);
  await field.click();
  await field.pressSequentially("счёт:сб");
  await page.keyboard.press("Tab");
  await expect(field).toHaveValue("счёт:Сбер");
});
