/**
 * Бюджет по правилам «Планов» Дзен-мани: переводы через границу баланса —
 * строками своих групп, входящий баланс — первой строкой поступлений, а статья
 * открывается окном со сводкой (план, остаток, подкатегории) над операциями.
 */
import type { Page } from "@playwright/test";
import { test, expect, connectZen } from "./harness";
import type { ZenDiffResponse, ZenTransaction } from "../src/lib/zenmoney";

type Zen = { patchFull: ((diff: ZenDiffResponse) => ZenDiffResponse) | null };

async function setup(page: Page, zen: Zen, mode: string, settings: string[] = []) {
  zen.patchFull = (diff) => {
    const sample = diff.transaction.find((t) => t.outcomeAccount !== t.incomeAccount)!;
    const back: ZenTransaction = {
      ...sample,
      id: "tx-from-save",
      date: "2026-10-07",
      outcome: 5_000,
      income: 5_000,
      outcomeAccount: "acc-save",
      incomeAccount: "acc-tbank",
      comment: "Из накоплений",
    };
    return {
      ...diff,
      // Накопительный счёт — вне баланса: переводы на него становятся строками.
      account: diff.account.map((a) => (a.id === "acc-save" ? { ...a, inBalance: false } : a)),
      transaction: [...diff.transaction, back],
      user: diff.user.map((u) => ({ ...u, planBalanceMode: mode, planSettings: JSON.stringify(settings) })),
    };
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connectZen(page, "/budgets");
}

test("«Баланс vs Расходы»: накопления строками и входящий баланс", async ({ page, zen }) => {
  await setup(page, zen, "balance");
  const main = page.locator("main");
  // Одинаковые подписи с обеих сторон, как в приложении: «Накопления» — и
  // перевод на накопительный (расход), и с него (поступление).
  await expect(main.getByRole("button", { name: "Накопления", exact: true })).toHaveCount(2);
  await expect(main.getByText("Входящий баланс", { exact: true })).toBeVisible();

  // Строку перевода нельзя запланировать: в Дзен-мани плана у неё нет.
  const row = main.locator(".card", { has: page.getByRole("button", { name: "Накопления", exact: true }) }).first();
  await expect(row).toContainText("20 000");

  // Окно статьи: сводка над операциями.
  await main.getByRole("button", { name: "Продукты", exact: true }).click();
  const summary = page.locator("[data-budget-cell-summary]");
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("План");
  await expect(summary).toContainText("Потрачено");
  await expect(summary).toContainText("Остаток");
});

test("будущий месяц: входящий баланс — прогнозом", async ({ page, zen }) => {
  await setup(page, zen, "balance");
  const main = page.locator("main");
  await expect(main.getByText("Входящий баланс", { exact: true })).toBeVisible();
  const next = main.locator("button", { has: page.locator("svg.lucide-chevron-right") }).first();
  await next.click();
  await expect(main.getByText(/Ноя\. 2026/).first()).toBeVisible();
  // В будущем месяце строка есть — прогноз остатка на конец текущего.
  const row = main.locator(".card", { hasText: "Входящий баланс" }).first();
  await expect(row).toBeVisible();
  await expect(row).not.toContainText(/^\s*0 ₽/);
});

test("«Доходы vs Расходы»: выключенная группа и без входящего баланса", async ({ page, zen }) => {
  await setup(page, zen, "excludeOpeningBalance", ["excludeTransferToSavings"]);
  const main = page.locator("main");
  // Перевод НА накопительный выключен — осталась только строка поступления.
  await expect(main.getByRole("button", { name: "Накопления", exact: true })).toHaveCount(1);
  await expect(main.getByText("Входящий баланс", { exact: true })).toHaveCount(0);
});
