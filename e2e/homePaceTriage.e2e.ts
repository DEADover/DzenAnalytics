/**
 * Виджеты главной «Темп трат» и «Разобрать», и подсказка дня в «Календаре»
 * при выключенных «Всплывающих подсказках».
 */
import { test, expect, connectZen } from "./harness";
import type { Page } from "@playwright/test";

type Store = { getState: () => Record<string, (...a: unknown[]) => Promise<void>> };
type Win = { __store: (n: string) => Promise<Record<string, Store>> };

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

const tile = (page: Page, name: string) => page.locator(`[data-tour="widget-${name}"]`);

/** Поставить снятый по умолчанию виджет на главную. */
async function place(page: Page, key: string, view?: string) {
  await page.evaluate(
    async ([k, v]) => {
      const w = window as unknown as Win;
      const { useDashboardLayoutStore } = await w.__store("useDashboardLayoutStore");
      await useDashboardLayoutStore.getState().setHidden(k, false);
      if (v) await useDashboardLayoutStore.getState().setView(k, v);
    },
    [key, view ?? ""] as const
  );
}

test("«Темп трат»: число, сравнение с прошлым месяцем и статьи", async ({ page }) => {
  await connectZen(page, "/");
  await place(page, "pace");
  const pace = tile(page, "pace");
  await expect(pace).toBeVisible();
  await expect(pace).toContainText("Потрачено к 15 октября");
  await expect(pace).toContainText("В сентябре к этому дню");
  await expect(pace.getByTestId("pace-total")).toContainText("₽");
  await expect(pace.locator(".recharts-line")).toHaveCount(2);

  // Статьи сходятся с числом в шапке: строки — это оно же, разложенное.
  const rows = pace.getByTestId("pace-categories");
  await expect(rows).toContainText("Дом");
  await expect(rows).toContainText("Продукты");

  // Клик по статье открывает её операции за месяц.
  await rows.getByRole("button", { name: /Дом/ }).click();
  await expect(page.locator("[data-exit-panel]")).toContainText("Дом · Октябрь");
  await page.keyboard.press("Escape");

  // «График»: три линии и легенда со средним.
  await place(page, "pace", "chart");
  await expect(pace.locator(".recharts-line")).toHaveCount(3);
  await expect(pace).toContainText("Среднее за 3 месяца");
  await expect(pace.getByTestId("pace-categories")).toHaveCount(0);
});

test("«Разобрать»: счётчики и переход к самим операциям", async ({ page }) => {
  await connectZen(page, "/");
  await place(page, "triage");
  const triage = tile(page, "triage");
  await expect(triage).toBeVisible();

  // В поддельном аккаунте две непросмотренные операции.
  const unseen = triage.locator('[data-triage="unseen"]');
  await expect(unseen).toHaveAttribute("data-count", "2");
  // Без категории нет — строка на месте, с галочкой и без клика.
  const uncat = triage.locator('[data-triage="uncategorized"]');
  await expect(uncat).toHaveAttribute("data-count", "0");
  await expect(uncat.getByLabel("Ничего не осталось")).toBeVisible();
  await expect(triage.locator('[data-triage="unsent"]')).toHaveAttribute("data-count", "0");

  await unseen.click();
  const drawer = page.locator("[data-exit-panel]");
  await expect(drawer).toContainText("Новые операции");
  await expect(drawer).toContainText("Перекрёсток");
  await expect(drawer).toContainText("Кофейня у дома");
});

test("«Календарь»: сумма дня показывается и при выключенных подсказках", async ({ page }) => {
  await connectZen(page, "/calendar");
  await page.evaluate(async () => {
    const w = window as unknown as Win;
    const { useDisplayStore } = await w.__store("useDisplayStore");
    await useDisplayStore.getState().setHints(false);
  });
  // 10 октября — аренда 35 000 ₽.
  const october = page.locator('[data-calendar-month="9"]');
  await october.getByRole("button", { name: "10", exact: true }).hover();
  const tip = page.getByRole("tooltip");
  await expect(tip).toContainText(/Расходы:.*35/);
  await expect(tip).toContainText(/операци/);
});
