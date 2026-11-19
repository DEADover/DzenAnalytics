/**
 * «Счета», вкладка «Капитал»: «Совокупный баланс» и «Общий остаток» под
 * списком — одно число до копейки, когда в списке все счета «в балансе».
 *
 * Валютные остатки после пересчёта дробные (606,4932 $ — 54 583,8… ₽). Строки
 * округляются при показе, а итоги складывали неокруглённые значения, и копейки
 * итогов со строками не сходились.
 */
import { test, expect, connectZen } from "./harness";

const kopecks = (s: string) =>
  Math.round(
    Number(
      s
        .replace(/[⁠⁣\s₽+]/g, "")
        .replace("−", "-")
        .replace(",", ".")
    ) * 100
  );

test("«Совокупный баланс» = «Общий остаток» = сумма строк, до копейки", async ({ page, zen }) => {
  zen.patchFull = (diff) => ({
    ...diff,
    account: [
      ...diff.account.map((a) => (a.id === "acc-usd" ? { ...a, balance: 606.4932 } : a)),
      { ...diff.account.find((a) => a.id === "acc-usd")!, id: "acc-usd2", title: "Доллары 2", balance: 100.0049 },
    ],
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connectZen(page, "/accounts");
  await page.evaluate(async () => {
    type S = { getState: () => { setFractionDigits: (n: number) => Promise<void> } };
    const store = (window as unknown as { __store: (n: string) => Promise<Record<string, S>> }).__store;
    const { useDisplayStore } = await store("useDisplayStore");
    await useDisplayStore.getState().setFractionDigits(2);
  });

  const kpi = page
    .locator("div.min-w-0", { has: page.locator(".label", { hasText: /^Совокупный баланс$/ }) })
    .first()
    .locator(":scope > div")
    .nth(1);
  const listTotal = page.locator("span", { has: page.locator("span.font-semibold", { hasText: /^Общий остаток:$/ }) });
  await expect(kpi).toContainText(",");
  await expect(listTotal).toBeVisible();

  const kpiValue = kopecks((await kpi.textContent()) ?? "");
  const listValue = kopecks(((await listTotal.textContent()) ?? "").split(":")[1] ?? "");
  expect(listValue).toBe(kpiValue);
  // Хотя бы одна строка — с копейками, иначе проверка ничего бы не доказала.
  expect(kpiValue % 100).not.toBe(0);
});
