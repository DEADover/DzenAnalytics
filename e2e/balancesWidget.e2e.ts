/**
 * «Балансы счетов» на главной: счета вне баланса включаются переключателем в
 * шапке виджета — только в нём (#116). Итоги сервиса решает настройка.
 */
import type { Page } from "@playwright/test";
import { test, expect, connectZen, choose, choiceButton } from "./harness";

const BROKER = "Брокерский счёт";

function widget(page: Page) {
  const head = page.locator(".block-title", { has: page.getByRole("heading", { name: "Балансы счетов" }) });
  return {
    head,
    total: head.locator("xpath=following-sibling::div[1]"),
    list: head.locator("xpath=following-sibling::div[2]"),
    choice: choiceButton(head, "Что показывать"),
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
  await expect(w.choice).toHaveAccessibleName("Что показывать: В балансе");
  await expect(w.list.getByText(BROKER)).toHaveCount(0);
  const before = money(await w.total.textContent());

  await choose(w.head, "Что показывать", "Все");
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
  await expect(widget(page).choice).toHaveAccessibleName("Что показывать: Все");
});

test("нет счетов вне баланса — нет и «В балансе / Все», только «Свободные»", async ({ page }) => {
  await connectZen(page, "/");
  await expect(widget(page).head).toBeVisible();
  await widget(page).choice.click();
  await expect(page.getByRole("menu", { name: "Что показывать" }).getByRole("menuitemradio")).toHaveText(["Счета", "Свободные"]);
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
      const seg = el.querySelector('[aria-haspopup="menu"]')!.getBoundingClientRect();
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

test("итог «Балансов счетов» — ровно сумма строк, с копейками и архивным счётом", async ({ page, zen }) => {
  // Валютный остаток с четырьмя знаками (606,4932 $ по 90 = 54 583,788 ₽) и
  // архивный счёт с деньгами: Дзен-мани его остаток в итогах считает. Раньше
  // итог брался из истории остатков, строка архивного счёта пряталась, и
  // копейки итога со строками не сходились.
  zen.patchFull = (diff) => ({
    ...diff,
    account: [
      ...diff.account.map((a) => (a.id === "acc-usd" ? { ...a, balance: 606.4932 } : a)),
      { ...diff.account[0], id: "acc-old", title: "Старый кошелёк", archive: true, balance: 838.73 },
    ],
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page, "/");
  await page.evaluate(async () => {
    type S = { getState: () => { setFractionDigits: (n: number) => Promise<void> } };
    const store = (window as unknown as { __store: (n: string) => Promise<Record<string, S>> }).__store;
    const { useDisplayStore } = await store("useDisplayStore");
    await useDisplayStore.getState().setFractionDigits(2);
  });
  const w = widget(page);
  // Архивный счёт свёрнут в строку «Архивные счета» со своим остатком.
  const group = w.list.locator("[data-archived-group]");
  await expect(group).toContainText("Архивные счета");
  await expect(group).toContainText("1 счёт с остатком");
  await expect(w.list.getByText("Старый кошелёк")).toHaveCount(0);

  const kopecks = (s: string) =>
    Math.round(Number(s.replace(/[⁠⁣\s₽]/g, "").replace("−", "-").replace(",", ".")) * 100);
  const rows = await w.list
    .locator("button .text-right > span:first-child")
    .allTextContents();
  const total = kopecks((await w.total.textContent()) ?? "");
  expect(rows.length).toBeGreaterThan(3);
  expect(total).toBe(rows.reduce((s, r) => s + kopecks(r), 0));
  // Валютная строка действительно с копейками — иначе проверка выше ничего
  // бы не доказывала.
  expect(rows.map(kopecks).some((k) => k % 100 !== 0 && k !== 83_873)).toBe(true);
  expect(rows.map(kopecks)).toContain(83_873);

  // Клик разворачивает строку: сам счёт с пометкой «Архив».
  await group.click();
  await expect(group).toHaveAttribute("aria-expanded", "true");
  await expect(w.list.getByText("Старый кошелёк")).toBeVisible();
  await expect(w.list.getByText(/· Архив/)).toBeVisible();
});
