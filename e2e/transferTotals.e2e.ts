/**
 * Итоги ленты при выбранном в фильтре счёте: переводы с другими счетами —
 * не доход и не расход, а «Переводы» с разбивкой «пришло / ушло» (жалоба
 * 24.11.2026: «переводы не равно доход, а графа Переводы пустая»).
 */
import type { Page } from "@playwright/test";
import { test, expect, connectZen } from "./harness";
import type { ZenDiffResponse, ZenTransaction } from "../src/lib/zenmoney";

/** Суммы приходят с неразрывными и невидимыми символами вокруг числа. */
const plain = (s: string | null) =>
  (s ?? "").replace(/[\u2060-\u2064]/g, "").replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " ").trim();

const cell = (page: Page, label: string) =>
  page.locator("div.min-w-0", { has: page.locator(".label", { hasText: new RegExp(`^${label}$`) }) }).first();

async function pickAccount(page: Page, id: string) {
  await page.evaluate(async (acc) => {
    type S = { getState: () => { setSet: (kind: string, values: Set<string>) => void } };
    const store = (window as unknown as { __store: (n: string) => Promise<Record<string, S>> }).__store;
    const { useFiltersStore } = await store("useFiltersStore");
    useFiltersStore.getState().setSet("accounts", new Set([acc]));
  }, id);
}

function withTransfers(diff: ZenDiffResponse): ZenDiffResponse {
  const sample = diff.transaction.find((t) => t.outcome > 0 && t.income === 0)!;
  const transfer = (id: string, from: string, to: string, date: string, amount: number): ZenTransaction => ({
    ...sample,
    id,
    date,
    tag: null,
    payee: null,
    comment: "Перевод между своими",
    outcome: amount,
    income: amount,
    outcomeAccount: from,
    incomeAccount: to,
  });
  return {
    ...diff,
    transaction: [
      ...diff.transaction,
      transfer("tx-in", "acc-sber", "acc-tbank", "2026-10-05", 5_000),
      transfer("tx-out", "acc-tbank", "acc-cash", "2026-10-06", 2_000),
    ],
  };
}

async function open(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page, "/transactions");
  await expect(cell(page, "Доходы")).toBeVisible();
  await pickAccount(page, "acc-tbank");
}

const num = async (page: Page, label: string) =>
  plain(await cell(page, label).locator(".stat-num").textContent());

/** «−17 000 ₽» → −17000. */
const money = (s: string) => Number(s.replace(/[^\d−-]/g, "").replace("−", "-")) || 0;

test.describe.serial("выбран счёт: переводы — в «Переводах», а не в доходах и расходах", () => {
  let before = { income: "", expense: "", net: 0 };

  test("без новых переводов", async ({ page }) => {
    await open(page);
    await expect.poll(() => num(page, "Операций")).not.toBe("");
    before = {
      income: await num(page, "Доходы"),
      expense: await num(page, "Расходы"),
      net: money(await num(page, "Переводы")),
    };
    expect(before.income).not.toBe("");
  });

  test("с переводами: доходы и расходы те же, переводы — пришло минус ушло", async ({ page, zen }) => {
    zen.patchFull = withTransfers;
    await open(page);
    // Пришло 5 000, ушло 2 000: «Переводы» выросли на 3 000.
    await expect.poll(async () => money(await num(page, "Переводы"))).toBe(before.net + 3_000);
    expect(await num(page, "Доходы")).toBe(before.income);
    expect(await num(page, "Расходы")).toBe(before.expense);
    // Сколько пришло и ушло — в подсказке карточки.
    await cell(page, "Переводы").hover();
    await expect(page.getByRole("tooltip")).toContainText("пришло");
  });
});
