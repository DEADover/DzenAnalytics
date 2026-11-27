/**
 * «Балансы счетов» → «Свободные»: баланс счетов минус расходы из виджета
 * «Запланированные операции» и накопительные счета.
 * Режим запоминается.
 */
import type { Page } from "@playwright/test";
import { test, expect, connectZen, choose } from "./harness";

const tile = (page: Page, name: string) => page.locator(`[data-tour="widget-${name}"]`);

/** Суммы приходят с неразрывными и невидимыми символами вокруг числа. */
const plain = (s: string | null) =>
  (s ?? "").replace(/[\u2060-\u2064]/g, "").replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " ");

/** Сумма строки разбивки по подписи: «Баланс счетов 372 150 ₽» → 372150. */
async function rowValue(scope: ReturnType<Page["locator"]>, label: string) {
  // Строка разбивки — подпись и сумма прямо в одном ряду; заголовок колонки
  // с той же подписью устроен иначе и сюда не попадает.
  const row = scope.locator(`div:has(> span:text-is("${label}")):has(> span:has-text("₽"))`).first();
  const text = plain(await row.locator("> span").last().textContent());
  const n = Number(text.replace(/[^\d,]/g, "").replace(",", "."));
  return text.includes("−") ? -n : n;
}

async function layout(page: Page) {
  await page.evaluate(async () => {
    type Store = { useDashboardLayoutStore: { getState: () => { replaceLayout: (r: unknown) => Promise<void> } } };
    const m = await (window as unknown as { __store: (n: string) => Promise<Store> }).__store("useDashboardLayoutStore");
    await m.useDashboardLayoutStore.getState().replaceLayout([
      { key: "month", kind: "month", view: "split" },
      { key: "accounts", kind: "accounts" },
      { key: "upcoming", kind: "upcoming", view: "zen" },
      { key: "freeMoney", kind: "freeMoney" },
    ]);
  });
}

test("«Свободные»: баланс минус запланированные траты и накопительные", async ({ page, zen }) => {
  zen.patchFull = (diff) => {
    const markers = diff.reminderMarker ?? [];
    const expense = markers.find((marker) => marker.outcome > 0)!;
    return {
      ...diff,
      reminderMarker: [
        ...markers.filter((marker) => marker.income > 0),
        { ...expense, id: "planned-socks", date: "2026-10-12", outcome: 720 },
        { ...expense, id: "planned-clothes", date: "2026-10-29", outcome: 6_000 },
        { ...expense, id: "planned-loan", date: "2026-10-30", outcome: 38_169 },
        { ...expense, id: "planned-mortgage", date: "2026-10-31", outcome: 28_613 },
        { ...expense, id: "planned-next-month", date: "2026-11-01", outcome: 99_000 },
        { ...expense, id: "planned-transfer", date: "2026-10-29", outcome: 500, income: 500, incomeAccount: "acc-sber" },
      ],
    };
  };
  await page.setViewportSize({ width: 1440, height: 1100 });
  await connectZen(page, "/");
  await layout(page);
  const accounts = tile(page, "accounts");
  await choose(accounts, "Что показывать", "Свободные");

  const breakdown = accounts.locator("[data-balances-free]");
  await expect(breakdown).toBeVisible();
  await expect(breakdown.getByText("Накопительный счёт", { exact: true })).toBeVisible();
  const balance = await rowValue(breakdown, "Баланс счетов");
  const planned = await rowValue(breakdown, "Запланированные траты");
  const savings = await rowValue(breakdown, "Накопительный счёт");
  expect(balance).toBeGreaterThan(0);

  // Только расход из списка платежей: входят просроченные, но не будущий
  // месяц, перевод или поступление. Остаток бюджета здесь не участвует.
  expect(planned).toBe(-73_502);
  await expect(tile(page, "upcoming").getByText(/^−\u2060?73\s502\s₽\u2063?$/)).toBeVisible();
  const freeMoney = tile(page, "freeMoney");
  const planLeft = await rowValue(freeMoney, "Остаток плана");
  expect(Math.abs(planLeft)).not.toBe(73_502);

  // Крупное число — результат вычитания.
  const big = plain(await accounts.locator(".font-mono").first().textContent());
  const value = Number(big.replace(/[^\d,]/g, "").replace(",", ".")) * (big.includes("−") || big.includes("-") ? -1 : 1);
  expect(value).toBeCloseTo(balance + planned + savings, 2);

  const hero = tile(page, "month");
  const freeAmount = hero.getByText("Свободные", { exact: true }).locator("..").locator("b");
  await expect(freeAmount).toBeVisible();
  expect(plain(await freeAmount.textContent())).toBe(big);
  await hero.getByRole("button", { expanded: false }).filter({ hasText: /октябрь/i }).click();
  await page.getByRole("menuitemradio", { name: /прошлый месяц/i }).click();
  await expect(hero.getByText("На счетах в конце", { exact: true })).toBeVisible();
  await expect(freeAmount).toHaveCount(0);

  // Выбор запоминается: после перезагрузки режим тот же.
  await page.reload();
  await expect(tile(page, "accounts").locator("[data-balances-free]")).toBeVisible();
  // Счетов вне баланса нет — первая кнопка просто «Счета».
  await choose(tile(page, "accounts"), "Что показывать", "Счета");
  await expect(tile(page, "accounts").locator("[data-balances-free]")).toHaveCount(0);
});
