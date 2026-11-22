/**
 * Настройка «Сумма в базовой валюте»: под суммой в другой валюте — она же в
 * рублях, в скобках. И в ленте, и в шторке. Выключена — подписи нет.
 */
import type { Page } from "@playwright/test";
import { test, expect, connectZen } from "./harness";

async function setOption(page: Page, on: boolean) {
  await page.evaluate(async (v) => {
    type S = { getState: () => { setAmountInBase: (x: boolean) => Promise<void> } };
    const w = window as unknown as { __store: (n: string) => Promise<Record<string, S>> };
    const { useDisplayStore } = await w.__store("useDisplayStore");
    await useDisplayStore.getState().setAmountInBase(v);
  }, on);
}

test("сумма в базовой валюте в ленте и в шторке", async ({ page, zen }) => {
  zen.patchFull = (diff) => {
    const usd = diff.instrument.find((i) => i.shortTitle === "USD")!.id;
    const sample = diff.transaction.find((t) => t.outcome > 0 && t.income === 0 && t.tag)!;
    return {
      ...diff,
      transaction: [
        ...diff.transaction,
        {
          ...sample,
          id: "tx-usd",
          date: "2026-10-15",
          payee: "Магазин в долларах",
          comment: null,
          outcome: 1_000,
          income: 1_000 * 0,
          outcomeInstrument: usd,
          incomeInstrument: usd,
          outcomeAccount: "acc-usd",
          incomeAccount: "acc-usd",
        },
      ],
    };
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connectZen(page, "/transactions");
  const row = page.locator(".op-row", { hasText: "Магазин в долларах" });
  await expect(row).toContainText("$");
  await expect(row.locator("[data-amount-base]")).toHaveCount(0);

  await setOption(page, true);
  await expect(row.locator("[data-amount-base]")).toContainText(/\(.*90.*₽/);
  // Операция в рублях подписи не получает.
  await expect(
    page.locator(".op-row", { hasText: "Пятёрочка" }).first().locator("[data-amount-base]")
  ).toHaveCount(0);

  // Наведение на сумму — курс и его дата.
  await row.locator("[data-amount-main]").hover();
  const tip = page.getByRole("tooltip");
  await expect(tip).toContainText(/1 \$ = 9\d/);
  await expect(tip).toContainText("Дата курса");
  await page.mouse.move(0, 0);

  // Шторка — та же настройка.
  await page.goto("/");
  await page.evaluate(async () => {
    type S = { getState: () => { setHidden: (k: string, h: boolean) => Promise<void> } };
    const w = window as unknown as { __store: (n: string) => Promise<Record<string, S>> };
    const { useDashboardLayoutStore } = await w.__store("useDashboardLayoutStore");
    await useDashboardLayoutStore.getState().setHidden("bigExpenses", false);
  });
  await page.locator('[data-big-expense="tx-usd"]').click();
  const drawer = page.locator("[data-exit-panel]");
  await expect(drawer.locator("[data-amount-base]")).toContainText(/\(.*90.*₽/);
});
