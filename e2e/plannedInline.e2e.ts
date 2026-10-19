/**
 * «Запланированные в ленте» → «В ленте»: планы стоят среди операций и
 * обрезаются концом выбранного периода (месяц — до его конца, год — до конца
 * года, всё время — все); строки «Запланировано» над лентой нет.
 */
import type { Page } from "@playwright/test";
import { test, expect, connectZen } from "./harness";

async function setFilters(page: Page, patch: Record<string, unknown>) {
  await page.evaluate(async (p) => {
    type S = { useFiltersStore: { setState: (x: unknown) => void } };
    const { useFiltersStore } = await (window as unknown as { __store: (n: string) => Promise<S> }).__store("useFiltersStore");
    // Set через границу страницы не переносится — собираем здесь.
    const q = { ...p } as Record<string, unknown>;
    if (Array.isArray(q.categories)) q.categories = new Set(q.categories as string[]);
    useFiltersStore.setState(q);
  }, patch);
}

const plan = (page: Page, id: string) => page.locator(`[data-plan-menu="${id}"]`);

test("планы в общей ленте по периоду", async ({ page }) => {
  await connectZen(page, "/settings?tab=interface");
  const choice = page.getByRole("group", { name: "Запланированные в ленте" });
  await choice.getByRole("button", { name: "В ленте" }).click();
  await expect(page.getByText("В ленте среди операций — до конца выбранного периода")).toBeVisible();
  await page.evaluate(() => {
    history.pushState({}, "", "/transactions");
    dispatchEvent(new PopStateEvent("popstate"));
  });

  // Строки «Запланировано» нет — планы в самой ленте.
  await expect(page.locator('[data-tour="planned"]')).toHaveCount(0);

  // Отчётный месяц (октябрь): просроченный 12.10 и аванс 25.10 — да, ноябрь — нет.
  await setFilters(page, { preset: "period" });
  await expect(plan(page, "mk-2026-10")).toBeVisible();
  await expect(plan(page, "mk-adv-2026-10")).toBeVisible();
  await expect(plan(page, "mk-2026-11")).toHaveCount(0);
  // Обычные операции на месте.
  await expect(page.locator("div.grid", { hasText: "Кофейня у дома" }).first()).toBeVisible();

  // Год — до конца декабря.
  await setFilters(page, { preset: "year" });
  await expect(plan(page, "mk-2026-11")).toBeVisible();
  await expect(plan(page, "mk-2026-12")).toBeVisible();
  await expect(plan(page, "mk-adv-2026-11")).toBeVisible();
  if (process.env.E2E_SHOTS) {
    await plan(page, "mk-adv-2026-10").scrollIntoViewIfNeeded();
    await page.screenshot({ path: process.env.E2E_SHOTS + "/planned-inline.png" });
  }

  // Меню плана работает и в общей ленте.
  // Меню закрывается прокруткой — сначала доводим кнопку до экрана.
  await plan(page, "mk-adv-2026-11").scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await plan(page, "mk-adv-2026-11").click();
  await expect(page.getByRole("button", { name: "Сохранить как факт" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Фильтр по категориям действует и на планы.
  await setFilters(page, { preset: "year", categories: ["Зарплата"] });
  await expect(plan(page, "mk-2026-11")).toHaveCount(0);
  await expect(plan(page, "mk-adv-2026-11")).toBeVisible();

  // Строкой — снова строка над лентой, планов в ленте нет.
  await page.evaluate(async () => {
    type S = { useDisplayStore: { getState: () => { setFeedPlannedMode: (m: string) => Promise<void> } } };
    const { useDisplayStore } = await (window as unknown as { __store: (n: string) => Promise<S> }).__store("useDisplayStore");
    await useDisplayStore.getState().setFeedPlannedMode("bar");
  });
  await setFilters(page, { categories: [] });
  await expect(page.locator('[data-tour="planned"]')).toBeVisible();
  await expect(plan(page, "mk-adv-2026-11")).toHaveCount(0);
});
