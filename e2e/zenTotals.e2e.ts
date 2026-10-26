/**
 * Итоги как в Дзен-мани:
 * - «Категории» — погашение кредитки вне баланса = расход «Кредиты и кредитки»;
 *   перевод в накопления вне баланса — не расход;
 * - плитки «Операций» — как «Итоги за период» в ленте приложения: перевод со
 *   счёта в балансе наружу (в накопления, на кредитку) — расход.
 */
import { test, expect, connectZen } from "./harness";
import type { ZenTransaction } from "../src/lib/zenmoney";

const money = (s: string) => Number(s.replace(/[^\d]/g, ""));

test("кредитка и накопительный вне баланса: категории и итоги ленты", async ({ page, zen }) => {
  zen.patchFull = (diff) => {
    const sample = diff.transaction.find((t) => t.outcomeAccount !== t.incomeAccount)!;
    const payCard: ZenTransaction = {
      ...sample,
      id: "tx-pay-card",
      date: "2026-10-09",
      outcome: 12_345,
      income: 12_345,
      outcomeAccount: "acc-tbank",
      incomeAccount: "acc-credit",
      tag: null,
      comment: "Погашение кредитки",
    };
    return {
      ...diff,
      account: [
        ...diff.account.map((a) => (a.id === "acc-save" ? { ...a, inBalance: false } : a)),
        { ...diff.account[0], id: "acc-credit", title: "Кредитка", type: "ccard", creditLimit: 100_000, inBalance: false, balance: -12_345 },
      ],
      transaction: [...diff.transaction, payCard],
    };
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connectZen(page, "/categories");
  const main = page.locator("main");
  await expect(main.getByText("Кредиты и кредитки", { exact: true }).first()).toBeVisible();
  await expect(main.getByText("12 345 ₽").first()).toBeVisible();

  // Лента: перевод в накопления (20 000) и погашение кредитки (12 345) — в расходах.
  await page.goto("/transactions");
  const tile = (label: string) =>
    main.locator("div", { has: page.getByText(label, { exact: true }) }).filter({ hasText: "₽" }).last();
  const expense = money(await tile("Расходы").innerText());
  await page.goto("/categories");
  const cats = money(
    await main.getByText("Все расходы", { exact: true }).locator("xpath=following::*[contains(text(),'₽')][1]").innerText()
  );
  expect(expense - cats).toBe(20_000);
});
