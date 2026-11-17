/**
 * #139: столбец «Время» перед «Счётом» и отметка новых операций полоской —
 * в ленте «Операций» и в списке операций сбоку.
 */
import type { Page } from "@playwright/test";
import { test, expect, connectZen } from "./harness";

type Win = { __store: (n: string) => Promise<Record<string, { getState: () => Record<string, unknown> }>> };

async function display(page: Page, time: boolean, mark: "dot" | "strip") {
  await page.evaluate(
    async ([t, m]) => {
      const { useDisplayStore } = await (window as unknown as Win).__store("useDisplayStore");
      const s = useDisplayStore.getState() as {
        setTimeColumn: (on: boolean) => Promise<void>;
        setNewMark: (v: string) => Promise<void>;
      };
      await s.setTimeColumn(t as boolean);
      await s.setNewMark(m as string);
    },
    [time, mark] as const
  );
}

const headLabels = (page: Page) => page.locator("main .list-head").first().locator("[data-col]").allInnerTexts();

test("лента: время перед счётом и полоска у новых", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connectZen(page, "/transactions");
  const main = page.locator("main");
  // По умолчанию — как было: без времени, точки.
  expect((await headLabels(page)).map((l) => l.trim().toLowerCase())).not.toContain("время");
  await expect(main.locator(".row-mark-new")).toHaveCount(0);
  await expect(main.getByRole("img", { name: "Новая операция" }).first()).toBeVisible();

  await display(page, true, "strip");
  const labels = (await headLabels(page)).map((l) => l.trim().toLowerCase());
  expect(labels.indexOf("время")).toBeGreaterThan(0);
  expect(labels.indexOf("время")).toBe(labels.indexOf("счёт") - 1);
  // Новые — полоской, без точки на значке.
  await expect(main.locator(".op-row.row-mark-new")).toHaveCount(2);
  await expect(main.getByRole("img", { name: "Новая операция" })).toHaveCount(0);
  const row = main.locator(".op-row.row-mark-new").first();
  await expect(row).toContainText(/\b\d{2}:\d{2}\b/);
  const shadow = await row.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(shadow).toContain("inset");
});

test("список сбоку: столбец «Время» и полоска у первой ячейки", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connectZen(page, "/transactions");
  await display(page, true, "strip");
  await page.evaluate(async () => {
    const w = window as unknown as Win;
    const { useDataStore } = await w.__store("useDataStore");
    const { useDrillStore } = await w.__store("useDrillStore");
    const txs = useDataStore.getState().transactions as unknown[];
    (useDrillStore.getState() as { show: (t: string, x: unknown[]) => void }).show("Все операции", txs);
  });
  const drawer = page.getByRole("complementary");
  const heads = (await drawer.locator("thead th").allInnerTexts()).map((t) => t.trim().toLowerCase());
  expect(heads.indexOf("время")).toBeGreaterThan(0);
  expect(heads.indexOf("время")).toBe(heads.indexOf("счёт") - 1);
  const marked = drawer.locator("tr.row-mark-new");
  await expect(marked).toHaveCount(2);
  const shadow = await marked.first().locator("td").first().evaluate((el) => getComputedStyle(el).boxShadow);
  expect(shadow).toContain("inset");
  await expect(marked.first()).toContainText(/\b\d{2}:\d{2}\b/);
});
