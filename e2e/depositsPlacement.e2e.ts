/**
 * «Вклады» на «Капитале» — сразу под списком счетов, а не в конце страницы
 * после графиков: это подробности по части тех же счетов.
 */
import { test, expect, connectZen } from "./harness";

test("блок «Вклады» — между списком счетов и графиком", async ({ page, zen }) => {
  zen.patchFull = (diff) => ({
    ...diff,
    account: [
      ...diff.account,
      {
        ...diff.account[0],
        id: "acc-deposit",
        title: "Вклад «Надёжный»",
        type: "deposit",
        balance: 300_000,
        startBalance: 300_000,
        startDate: "2026-09-01",
        percent: 16,
        capitalization: true,
        endDateOffset: 12,
        endDateOffsetInterval: "month",
        payoffStep: 1,
        payoffInterval: "month",
      },
    ],
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connectZen(page, "/accounts");
  const main = page.locator("main");
  const deposits = main.getByText("Вклады", { exact: true }).first();
  await expect(deposits).toBeVisible();
  const list = main.locator("table.acc-table");
  const chart = main.getByText("Остатки по счетам", { exact: true }).first();
  const y = async (l: typeof list) => (await l.boundingBox())!.y;
  expect(await y(deposits)).toBeGreaterThan(await y(list));
  expect(await y(deposits)).toBeLessThan(await y(chart));
});
