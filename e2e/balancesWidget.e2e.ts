/**
 * «Балансы счетов» на главной: счета вне баланса включаются переключателем в
 * шапке виджета — только в нём (#116). Итоги сервиса решает настройка.
 */
import type { Page } from "@playwright/test";
import { test, expect, connectZen } from "./harness";

const BROKER = "Брокерский счёт";

function widget(page: Page) {
  const head = page.locator(".block-title", { has: page.getByRole("heading", { name: "Балансы счетов" }) });
  return {
    head,
    total: head.locator("xpath=following-sibling::div[1]"),
    list: head.locator("xpath=following-sibling::div[2]"),
    choice: head.getByRole("group", { name: "Какие счета показывать" }),
  };
}

const money = (s: string | null) => Number((s ?? "").replace(/[^\d−-]/g, "").replace("−", "-"));

test("счета вне баланса в «Балансах счетов» — своим переключателем", async ({ page, zen }) => {
  zen.patchFull = (diff) => ({
    ...diff,
    account: [
      ...diff.account,
      { ...diff.account[0], id: "acc-broker", title: BROKER, inBalance: false, balance: 50_000 },
    ],
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page, "/");
  const w = widget(page);

  // По умолчанию — как в «Расчётах»: только счета в балансе.
  await expect(w.choice.getByRole("button", { name: "В балансе" })).toHaveAttribute("aria-pressed", "true");
  await expect(w.list.getByText(BROKER)).toHaveCount(0);
  const before = money(await w.total.textContent());

  await w.choice.getByRole("button", { name: "Все" }).click();
  await expect(w.list.getByText(BROKER)).toBeVisible();
  await expect.poll(async () => money(await w.total.textContent())).toBe(before + 50_000);

  // Только этот виджет: настройка в «Расчётах» не тронута.
  const global = await page.evaluate(async () => {
    type S = { getState: () => { includeOffBalance: boolean } };
    const store = (window as unknown as { __store: (n: string) => Promise<Record<string, S>> }).__store;
    const { useOffBalanceStore } = await store("useOffBalanceStore");
    return useOffBalanceStore.getState().includeOffBalance;
  });
  expect(global).toBe(false);

  // Выбор запоминается.
  await page.reload();
  await expect(widget(page).list.getByText(BROKER)).toBeVisible();
  await expect(widget(page).choice.getByRole("button", { name: "Все" })).toHaveAttribute("aria-pressed", "true");
});

test("нет счетов вне баланса — нет и переключателя", async ({ page }) => {
  await connectZen(page, "/");
  await expect(widget(page).head).toBeVisible();
  await expect(widget(page).choice).toHaveCount(0);
});

test("шапка с переключателем: заголовок не режется ни на одной ширине", async ({ page, zen }) => {
  zen.patchFull = (diff) => ({
    ...diff,
    account: [...diff.account, { ...diff.account[0], id: "acc-broker", title: BROKER, inBalance: false, balance: 50_000 }],
  });
  await connectZen(page, "/");
  const problems: string[] = [];
  for (const width of [1280, 1366, 1440, 1536, 1920, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(200);
    const r = await widget(page).head.evaluate((el) => {
      const h3 = el.querySelector("h3")!;
      const seg = el.querySelector('[role="group"]')!.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      const link = el.querySelector("a")!.getBoundingClientRect();
      const title = h3.getBoundingClientRect();
      const mid = (r: DOMRect) => r.top + r.height / 2;
      return {
        titleCut: h3.scrollWidth > h3.clientWidth + 0.5,
        segOut: seg.right > box.right + 0.5 || seg.left < box.left - 0.5,
        // Ссылка — в строке заголовка; второй строкой уходит только переключатель.
        linkAway: Math.abs(mid(link) - mid(title)) > 6,
      };
    });
    if (r.titleCut) problems.push(`${width}: заголовок обрезан`);
    if (r.segOut) problems.push(`${width}: переключатель вылез из шапки`);
    if (r.linkAway) problems.push(`${width}: ссылка ушла со строки заголовка`);
  }
  expect(problems, problems.join("\n")).toEqual([]);
});
