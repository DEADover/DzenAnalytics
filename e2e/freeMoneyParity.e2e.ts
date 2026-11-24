/**
 * «Свободные деньги» и «Бюджет месяца» считают как виджет Дзен-мани: запертая
 * категория не теряет запас подкатегории, лимит на день один на весь месяц, а
 * перерасход прошлых дней виден в блоке «На сегодня».
 *
 * Октябрь, сегодня 15-е, осталось 17 дней из 31:
 *   доходы   план 31 000, пришло 31 000
 *   покупки  замок 2 000, подписки под замком 13 500; потрачено 1 000 + 5 000
 *   машина   замок 2 000; потрачено 34 000
 */
import type { Page } from "@playwright/test";
import { test, expect, connectZen, choose } from "./harness";
import type { ZenBudget, ZenDiffResponse, ZenTransaction } from "../src/lib/zenmoney";

type Zen = { patchFull: ((diff: ZenDiffResponse) => ZenDiffResponse) | null };

function scenario(diff: ZenDiffResponse): ZenDiffResponse {
  const base = diff.tag[0];
  const tag = (id: string, title: string, parent: string | null = null) => ({ ...base, id, title, parent });
  const user = diff.user[0].id;
  const budget = (t: string, income: number, outcome: number): ZenBudget => ({
    user,
    changed: 1,
    date: "2026-10-01",
    tag: t,
    income,
    incomeLock: true,
    outcome,
    outcomeLock: true,
  });
  const sample = diff.transaction.find((t) => t.outcome > 0 && t.income === 0)!;
  const spend = (id: string, t: string, date: string, amount: number): ZenTransaction => ({
    ...sample,
    id,
    date,
    tag: [t],
    outcome: amount,
    income: 0,
    outcomeAccount: "acc-tbank",
    incomeAccount: "acc-tbank",
    comment: null,
  });
  const earn = (id: string, t: string, date: string, amount: number): ZenTransaction => ({
    ...spend(id, t, date, 0),
    income: amount,
  });
  return {
    ...diff,
    tag: [
      { ...tag("t-job", "Работа"), showIncome: true, showOutcome: false, budgetIncome: true, budgetOutcome: false },
      tag("t-shop", "Покупки"),
      tag("t-subs", "Подписки", "t-shop"),
      tag("t-car", "Машина"),
    ],
    budget: [
      budget("t-job", 31_000, 0),
      budget("t-shop", 0, 2_000),
      budget("t-subs", 0, 13_500),
      budget("t-car", 0, 2_000),
    ],
    transaction: [
      earn("tx-job", "t-job", "2026-10-02", 31_000),
      spend("tx-shop", "t-shop", "2026-10-03", 1_000),
      spend("tx-subs", "t-subs", "2026-10-04", 5_000),
      spend("tx-car", "t-car", "2026-10-10", 34_000),
    ],
    reminder: [],
    reminderMarker: [],
  };
}

async function open(page: Page, zen: Zen) {
  zen.patchFull = scenario;
  await page.setViewportSize({ width: 1440, height: 1100 });
  await connectZen(page, "/");
  await page.evaluate(async () => {
    type Store = { useDashboardLayoutStore: { getState: () => { replaceLayout: (r: unknown) => Promise<void> } } };
    const m = await (window as unknown as { __store: (n: string) => Promise<Store> }).__store("useDashboardLayoutStore");
    await m.useDashboardLayoutStore.getState().replaceLayout([
      { key: "freeMoney", kind: "freeMoney" },
      { key: "budget", kind: "budget" },
    ]);
  });
}

/** Суммы приходят с неразрывными и невидимыми символами вокруг числа. */
const plain = (s: string | null) =>
  (s ?? "").replace(/[\u2060-\u2064]/g, "").replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " ");

test("«Свободные деньги»: минус, полная сумма и перерасход прошлых дней", async ({ page, zen }) => {
  await open(page, zen);
  const main = page.locator("main");
  await expect(main.getByRole("heading", { name: "Свободные деньги" })).toBeVisible();
  const text = async () => plain(await main.textContent());

  // Свободные: −9 000 баланса − 8 500 остатка плана; без перебора было бы 15 500.
  await expect.poll(text).toContain("Не хватает до");
  await expect.poll(text).toContain("17 500 ₽на запланированные расходы");
  await expect.poll(text).toContain(
    "Было бы свободно 15 500 ₽, но перерасход забрал 33 000 ₽"
  );
  // Лимит 15 500 ÷ 31 = 500; на сегодня −17 500 − 500 × 16 дней = −25 500.
  await expect.poll(text).toContain("25 500 ₽");
  await expect.poll(text).toContain("Потрачено сверх лимита 500 ₽ на сегодня");
  await expect.poll(text).toContain("Перерасход накопился за прошлые дни");
  // Запас «Подписок» остался в плане запертых «Покупок».
  await expect.poll(text).toContain("Баланс периода− 9 000 ₽");
  await expect.poll(text).toContain("Остаток плана− 8 500 ₽");

  // Ежедневный режим при нехватке: как в Дзен-мани, 0 ₽ вместо прочерка.
  await choose(main, "Как делить свободные деньги по дням", "Ежедневный");
  await expect.poll(text).toContain("0 ₽Свободных денег на сегодня нет");
  await expect.poll(text).toContain("17 500 ₽на запланированные расходы");
});

test("«Бюджет месяца»: запас подкатегории под замком остаётся в планах", async ({ page, zen }) => {
  await open(page, zen);
  const summary = page.getByTestId("budget-summary");
  await expect.poll(async () => plain(await summary.textContent())).toContain("Ещё 8 500 ₽ в планах");
  await expect.poll(async () => plain(await summary.textContent())).toContain("на 33 000 ₽");
});
