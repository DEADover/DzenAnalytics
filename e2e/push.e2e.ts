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

  test("в «При синхронизации» уходит со следующей синхронизацией", async ({ page, zen }) => {
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

/** Переключатель режима отправки — одной строкой рядом с подписью и кнопкой,
 *  самая длинная подпись («При синхронизации») не обрезается и не переносится. */
for (const width of [1440, 1280]) {
  test(`переключатель режима отправки помещается в строку (${width})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await connectZen(page, "/settings?tab=source&source=api");
    const box = page.locator('[data-tour="push-mode"]');
    const seg = box.getByRole("group", { name: "Отправка правок в облако" });
    await expect(seg.getByRole("button", { name: "При синхронизации" })).toBeVisible();
    const m = await seg.evaluate((el) => {
      const bs = [...el.querySelectorAll("button")];
      const row = el.parentElement!;
      const label = row.querySelector("span")!;
      const send = row.querySelector(":scope > button")!;
      return {
        tops: bs.map((b) => Math.round(b.getBoundingClientRect().top)),
        clipped: bs.filter((b) => b.scrollWidth > b.clientWidth + 1 || b.getBoundingClientRect().height > 40).map((b) => b.textContent),
        rowTops: [label, el, send].map((n) => Math.round(n.getBoundingClientRect().top + n.getBoundingClientRect().height / 2)),
      };
    });
    expect(new Set(m.tops).size, `кнопки режима в разных строках: ${m.tops.join(", ")}`).toBe(1);
    expect(m.clipped, "подписи режима обрезаны или перенесены").toEqual([]);
    expect(new Set(m.rowTops).size, `ряд переносится: ${m.rowTops.join(", ")}`).toBe(1);
    if (process.env.E2E_SHOTS) await box.screenshot({ path: `${process.env.E2E_SHOTS}/push-mode-${width}.png` });
  });
}
