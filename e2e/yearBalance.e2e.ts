/**
 * «Год в цифрах»: баланс на начало года, сейчас, максимум и минимум (#132).
 */
import { test, expect, connectZen } from "./harness";

test("баланс за год — вторым рядом итогов, в одну строку", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page, "/year-review");
  const labels = ["Баланс на начало года", "Баланс сейчас", "Максимум за год", "Минимум за год"];
  const tops: number[] = [];
  for (const label of labels) {
    const cell = page.locator(".label", { hasText: label }).locator("xpath=ancestor::div[2]");
    await expect(cell).toContainText("₽");
    // Подпись не обрезана.
    const l = page.locator(".label", { hasText: label });
    expect(await l.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    tops.push(Math.round((await l.boundingBox())!.y));
  }
  expect(new Set(tops).size).toBe(1);
});

const money = (s: string) => Number(s.replace(/[^\d−-]/g, "").replace("−", "-"));

test("счёт вне баланса в баланс за год не входит, пока не включены «Счета вне баланса»", async ({ page, zen }) => {
  // Накопительный счёт (250 000 ₽, пополняется переводами) — вне баланса.
  zen.patchFull = (diff) => ({
    ...diff,
    account: diff.account.map((a) => (a.id === "acc-save" ? { ...a, inBalance: false } : a)),
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page, "/year-review");
  const value = async (label: string) => {
    const cell = page.locator(".label", { hasText: label }).locator("xpath=ancestor::div[2]");
    return money((await cell.locator(".stat-num").textContent())!);
  };
  await expect(page.locator(".label", { hasText: "Баланс сейчас" })).toBeVisible();
  const without = { now: await value("Баланс сейчас"), start: await value("Баланс на начало года") };

  await page.evaluate(async () => {
    type S = { getState: () => { setIncludeOffBalance: (v: boolean) => Promise<void> } };
    const w = window as unknown as { __store: (n: string) => Promise<{ useOffBalanceStore: S }> };
    const { useOffBalanceStore } = await w.__store("useOffBalanceStore");
    await useOffBalanceStore.getState().setIncludeOffBalance(true);
  });
  // С накопительным счётом «сейчас» больше ровно на его остаток.
  await expect.poll(() => value("Баланс сейчас")).toBe(without.now + 250_000);
  // И начало года сдвигается: накопления были и тогда.
  expect(await value("Баланс на начало года")).toBeGreaterThan(without.start);
});
