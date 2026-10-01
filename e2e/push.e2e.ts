/**
 * Отправка правок в Дзен-мани — что и когда уходит в облако.
 */
import type { Page } from "@playwright/test";
import { test, expect, connectZen, setPushMode } from "./harness";

/** Поправить план «Продуктов» на октябрь в «Бюджет → Год» — как человек. */
async function editFoodPlan(page: Page, amount: string) {
  await page.goto("/budgets");
  await page.getByRole("button", { name: "Год", exact: true }).click();
  await page.getByRole("button", { name: /^Изменить план: Продукты · / }).first().click();
  await page.getByLabel(/^План на октябрь/).fill(amount);
  await page.getByRole("button", { name: /Сохранить/ }).click();
}

test.describe("правка одних только планов", () => {
  test("в «Вручную» видна в очереди и уходит по кнопке (#113)", async ({ page, zen }) => {
    await connectZen(page);
    await setPushMode(page, "manual");
    await editFoodPlan(page, "31000");

    const review = page.locator('button[title^="Просмотреть изменения перед отправкой"]');
    await expect(review).toHaveText("1");
    await review.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Бюджет", { exact: true })).toBeVisible();
    await expect(dialog.getByText(/Расходы · Октябрь 2026 · План 31\s000/)).toBeVisible();
    await page.keyboard.press("Escape");

    await page.locator('button[title="Отправить изменения в Дзен-мани"]').click();
    await page.getByRole("dialog").getByRole("button", { name: "Отправить" }).click();

    await expect.poll(() => zen.pushes.length).toBe(1);
    expect(zen.pushes[0].budget).toEqual([
      expect.objectContaining({ tag: "tag-food", date: "2026-10-01", outcome: 31_000, outcomeLock: true }),
    ]);
    await expect(page.locator('button[title="Нет изменений, ожидающих отправки"]')).toHaveText("0");
  });

  test("в «При синке» уходит со следующей синхронизацией", async ({ page, zen }) => {
    await connectZen(page);
    await setPushMode(page, "on-sync");
    await editFoodPlan(page, "27500");

    await page.locator('button[title^="Синхронизация с Дзен-мани"]').click();
    await expect.poll(() => zen.pushes.length).toBe(1);
    expect(zen.pushes[0].budget?.[0]).toMatchObject({ tag: "tag-food", outcome: 27_500 });
  });

  test("в «Выключено» не уходит никуда", async ({ page, zen }) => {
    await connectZen(page);
    await editFoodPlan(page, "40000");
    await page.locator('button[title^="Синхронизация с Дзен-мани"]').click();
    await expect.poll(() => zen.pulls).toBeGreaterThan(1);
    expect(zen.pushes).toHaveLength(0);
  });
});
