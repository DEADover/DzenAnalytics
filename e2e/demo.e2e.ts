/**
 * «Открыть демо-данные» без своего аккаунта: выдуманная семья в отдельном
 * аккаунте панели, «Дзен-мани» отвечает из браузера — в сеть не уходит ничего.
 */
import { test, expect } from "./harness";

test("демо-данные: открываются из пустой панели, работают без сети, выход стирает их", async ({ page, zen }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "С чего начнём?" })).toBeVisible();
  // Без данных настраивать главную нечего — кнопка погашена.
  const layoutBtn = page.getByRole("button", { name: "Настроить главную" }).first();
  await expect(layoutBtn).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("button", { name: "Открыть демо-данные" }).click();

  const banner = page.getByText("Это демо-данные выдуманной семьи.");
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "С чего начнём?" })).toHaveCount(0);
  await expect(layoutBtn).toHaveAttribute("aria-disabled", "false");

  // История доходит до «сегодня» (часы тестов — 15.10.2026), а не дальше.
  const range = await page.evaluate(async () => {
    type Store = { useDataStore: { getState: () => { transactions: { date: string; kind: string }[] } } };
    const { useDataStore } = await (window as unknown as { __store: (n: string) => Promise<Store> }).__store("useDataStore");
    const txs = useDataStore.getState().transactions;
    const dates = txs.map((t) => t.date).sort();
    return { first: dates[0], last: dates[dates.length - 1], count: dates.length, refunds: txs.filter((t) => t.kind === "refund").length };
  });
  // Возвраты панель распознала как возвраты, а не доходы.
  expect(range.refunds).toBeGreaterThan(20);
  expect(range.last.slice(0, 7)).toBe("2026-10");
  expect(range.last <= "2026-10-15").toBe(true);
  // Пять лет истории.
  expect(range.first.slice(0, 7)).toBe("2021-11");
  expect(range.count).toBeGreaterThan(5000);

  // Счета выдуманной семьи.
  await page.goto("/accounts");
  await expect(page.getByText("Т-Банк Black").first()).toBeVisible();

  // Цели, правила и удалённые дубли.
  await page.goto("/goals");
  await expect(page.getByText("Отпуск в Японии").first()).toBeVisible();
  await page.goto("/rules");
  await expect(page.getByText("Такси — в «Такси»").first()).toBeVisible();
  // Хэштеги — за всё время (за один месяц их немного: так и задумано).
  await page.goto("/tags");
  await page.getByRole("button", { name: "Всё", exact: true }).first().click();
  await expect(page.getByText("Собака").first()).toBeVisible();
  await expect(page.getByText("Лечение").first()).toBeVisible();
  await expect(page.getByText("Отпуск").first()).toBeVisible();
  await page.goto("/recurring");
  await expect(page.getByText("Кинопоиск").first()).toBeVisible();
  await page.goto("/trash");
  await expect(page.getByText("Дубль — списали дважды").first()).toBeVisible();

  // Сравнение: идущий октябрь против сентября.
  await page.goto("/compare");
  await expect(page.getByTestId("compare-track-summary")).toContainText("к тому же дню");

  // В настоящий Дзен-мани не ушло ни одного запроса.
  expect(zen.pulls).toBe(0);
  expect(zen.pushes).toHaveLength(0);

  // Выход — обратно в пустую панель, демо-база стёрта.
  await page.getByRole("button", { name: "Выйти из демо" }).click();
  await expect(page.getByRole("heading", { name: "С чего начнём?" })).toBeVisible({ timeout: 20_000 });
  await expect(banner).toHaveCount(0);
  const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  expect(dbs.filter((n) => n && n !== "dzenanalytics")).toEqual([]);
});
