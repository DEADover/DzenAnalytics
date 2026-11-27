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

function scenario(diff: ZenDiffResponse) {
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
      { ...tag("t-subs", "Подписки", "t-shop"), showIncome: true, showOutcome: true },
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

async function open(page: Page, zen: Zen, patchFull: (diff: ZenDiffResponse) => ZenDiffResponse = scenario) {
  zen.patchFull = patchFull;
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

test("доход подкатегории не увеличивает остаток расходного плана (#148)", async ({ page, zen }) => {
  await open(page, zen, (diff) => {
    const data = scenario(diff);
    const income = {
      ...data.transaction[0],
      id: "tx-subs-income",
      tag: ["t-subs"],
      income: 136.21,
    };
    return { ...data, transaction: [...data.transaction, income] };
  });

  const widget = page.locator('[data-tour="widget-freeMoney"]');
  await expect.poll(async () => plain(await widget.textContent())).toContain("Остаток плана− 8 500 ₽");
  await expect.poll(async () => plain(await page.getByTestId("budget-summary").textContent())).toContain("Ещё 8 500 ₽ в планах");
});

for (const [mode, parentLeft] of [
  ["balance", "3,50"],
  ["excludeOpeningBalance", "133,00"],
] as const) {
  test(`остатки родителя и подкатегорий при возврате и смешанном доходе — ${mode} (#148)`, async ({ page, zen }) => {
    await open(page, zen, (diff) => {
      const data = scenario(diff);
      const sample = data.transaction[0];
      const parent = { ...data.tag[1], title: "Структуры" };
      const mixed = { ...data.tag[2], title: "Финансы" };
      const education = { ...mixed, id: "t-education", title: "Образование", showIncome: false };
      return {
        ...data,
        user: data.user.map((user) => ({ ...user, planBalanceMode: mode })),
        tag: [parent, mixed, education],
        budget: [
          { ...data.budget[1], outcome: 102 },
          { ...data.budget[2], outcome: 2 },
          { ...data.budget[2], tag: education.id, outcome: 100 },
        ],
        transaction: [
          { ...sample, id: "finance-spend", tag: [mixed.id], income: 0, outcome: 1.1 },
          { ...sample, id: "education-spend", tag: [education.id], income: 0, outcome: 97.4 },
          { ...sample, id: "mixed-income", tag: [mixed.id], income: 136.21 },
          { ...sample, id: "parent-refund", tag: [parent.id], income: 129.5 },
        ],
      };
    });
    await page.evaluate(async () => {
      type Store = { useDisplayStore: { getState: () => { setFractionDigits: (value: number) => Promise<void> } } };
      const lookup = (window as unknown as { __store: (name: string) => Promise<Store> }).__store;
      await (await lookup("useDisplayStore")).useDisplayStore.getState().setFractionDigits(2);
    });

    const widget = page.locator('[data-tour="widget-freeMoney"]');
    const row = (name: string) => widget.getByText(name, { exact: true }).locator("..");
    await expect.poll(async () => plain(await row("Финансы").textContent())).toBe("Финансы0,90 ₽");
    await expect.poll(async () => plain(await row("Образование").textContent())).toBe("Образование2,60 ₽");
    await expect.poll(async () => plain(await row("Структуры").textContent())).toBe(`Структуры${parentLeft} ₽`);
    await expect.poll(async () => plain(await widget.textContent())).toContain(`Остаток плана− ${parentLeft} ₽`);
    const summary = page.getByTestId("budget-summary");
    await expect.poll(async () => plain(await summary.textContent())).toContain(`Ещё ${parentLeft} ₽ в планах`);
  });
}
