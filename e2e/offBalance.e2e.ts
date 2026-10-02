/**
 * Счета вне баланса — одно правило на весь сервис: пока переключатель в
 * «Расчётах» выключен, их операции не входят ни в какие итоги. Раньше
 * «Категории» считали их, а главная и «Сравнение» — нет.
 */
import type { Page } from "@playwright/test";
import { test, expect, connectZen } from "./harness";
import type { ZenTransaction } from "../src/lib/zenmoney";

const BROKER = "acc-broker";
const FEE = "Комиссии брокера";

async function go(page: Page, to: string) {
  await page.evaluate((path) => {
    history.pushState(null, "", path);
    dispatchEvent(new PopStateEvent("popstate"));
  }, to);
  await page.waitForTimeout(400);
}

async function setInclude(page: Page, on: boolean) {
  await page.evaluate(async (v) => {
    type S = { getState: () => { setIncludeOffBalance: (v: boolean) => Promise<void> } };
    const store = (window as unknown as { __store: (n: string) => Promise<Record<string, S>> }).__store;
    const { useOffBalanceStore } = await store("useOffBalanceStore");
    await useOffBalanceStore.getState().setIncludeOffBalance(v);
  }, on);
}

test("операции счёта вне баланса — везде одинаково", async ({ page, zen }) => {
  zen.patchFull = (diff) => {
    const sample = diff.transaction.find((t) => t.outcome > 0 && t.income === 0)!;
    const fee: ZenTransaction = {
      ...sample,
      id: "tx-broker-fee",
      date: "2026-10-08",
      outcome: 7_000,
      income: 0,
      outcomeAccount: BROKER,
      incomeAccount: BROKER,
      tag: ["tag-fee"],
      payee: "Брокер",
      comment: null,
    };
    return {
      ...diff,
      account: [...diff.account, { ...diff.account[0], id: BROKER, title: "Брокерский счёт", inBalance: false, balance: 50_000 }],
      tag: [...diff.tag, { ...diff.tag[0], id: "tag-fee", title: FEE, parent: null }],
      transaction: [...diff.transaction, fee],
    };
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page, "/categories");

  // Выключено (по умолчанию): трата брокера не считается нигде.
  await expect(page.getByText("Продукты").first()).toBeVisible();
  await expect(page.getByText(FEE)).toHaveCount(0);
  await go(page, "/compare");
  await expect(page.getByText("Продукты").first()).toBeVisible();
  await expect(page.getByText(FEE)).toHaveCount(0);
  // Отбора-двойника в фильтрах больше нет.
  await expect(page.getByText("Без внебалансовых счетов")).toHaveCount(0);

  // Включено: считается везде.
  await setInclude(page, true);
  await go(page, "/categories");
  await expect(page.getByText(FEE).first()).toBeVisible();
  await go(page, "/compare");
  await expect(page.getByText(FEE).first()).toBeVisible();
});
