/**
 * Главная со ВСЕМИ виджетами — на телефоне и на компьютере: заголовки целы,
 * ничего не уезжает вбок. Часть виджетов по умолчанию выключена, поэтому
 * раскладка ставится целиком, в каждом варианте «Итогов месяца».
 */
import type { Page } from "@playwright/test";
import { test, expect, connectZen, horizontalOverflow } from "./harness";

const KINDS = [
  "month", "accounts", "upcoming", "freeMoney", "freeMoneyCompact", "links", "cashflow",
  "capital", "monthOverMonth", "categories", "activity", "observations", "donutExpense", "donutIncome",
];

async function allWidgets(page: Page, monthView: string) {
  await page.evaluate(
    async ({ kinds, monthView }) => {
      type Store = { useDashboardLayoutStore: { getState: () => { replaceLayout: (r: unknown) => Promise<void> } } };
      const m = await (window as unknown as { __store: (n: string) => Promise<Store> }).__store("useDashboardLayoutStore");
      await m.useDashboardLayoutStore
        .getState()
        .replaceLayout(kinds.map((k) => ({ key: k, kind: k, ...(k === "month" ? { view: monthView } : {}) })));
    },
    { kinds: KINDS, monthView }
  );
  await page.waitForTimeout(800);
}

/** Заголовки виджетов, обрезанные многоточием. */
const clippedTitles = (page: Page) =>
  page.locator("main h3").evaluateAll((hs) =>
    hs.filter((h) => h.scrollWidth > h.clientWidth + 1).map((h) => h.textContent?.trim() ?? "")
  );

for (const width of [375, 768, 1280]) {
  for (const view of ["open", "framed", "split"]) {
    test(`главная ${width}px, «Итоги месяца» — ${view}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await connectZen(page, "/");
      await allWidgets(page, view);
      expect(await horizontalOverflow(page)).toBe(0);
      expect(await clippedTitles(page)).toEqual([]);
      // Суммы плиток «Месяца к месяцу» — в одну строку.
      const wrapped = await page.getByText(/^150\s000\s₽$/).evaluateAll((els) =>
        els.filter((e) => e.getBoundingClientRect().height > parseFloat(getComputedStyle(e).fontSize) * 1.6).length
      );
      expect(wrapped).toBe(0);
    });
  }
}

for (const width of [375, 1280]) {
  test(`«Доходы и расходы» с выбросами, ${width}px: подписи осей и столбцов не срезаны`, async ({ page, zen }) => {
    // Месяцы с крупной покупкой и разовым доходом — шкала режется по выбросам.
    const orig = zen.respond.bind(zen);
    zen.respond = (body) => {
      const r = orig(body);
      if (body.serverTimestamp === 0) {
        const t = r.transaction[0];
        const big = (id: string, date: string, outcome: number, income: number, tag: string) => ({
          ...t, id, date, outcome, income, tag: [tag], payee: "Выброс",
        });
        r.transaction.push(
          big("big-exp", "2026-05-15", 812_000, 0, "tag-home"),
          big("big-inc", "2026-07-15", 0, 1_400_000, "tag-salary")
        );
      }
      return r;
    };
    await page.setViewportSize({ width, height: 900 });
    await connectZen(page, "/");
    const chart = page
      .locator("h3", { hasText: "Доходы и расходы" })
      .locator("xpath=ancestor::div[.//div[contains(@class,'recharts-wrapper')]][1]")
      .locator(".recharts-wrapper")
      .first();
    await chart.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    const outside = await chart.evaluate((el) => {
      const svg = el.querySelector("svg")!.getBoundingClientRect();
      return [...el.querySelectorAll("svg text")]
        .filter((t) => {
          const b = t.getBoundingClientRect();
          return b.width > 0 && (b.left < svg.left - 0.5 || b.right > svg.right + 0.5 || b.top < svg.top - 0.5);
        })
        .map((t) => t.textContent);
    });
    expect(outside).toEqual([]);
  });
}
