/**
 * Столбцы разницы: переключатель «₽ → % → ₽ %» в шапке, один на все таблицы,
 * режим запоминается для каждой таблицы отдельно, и ни в одном режиме не
 * режутся ни подпись столбца, ни сами суммы.
 */
import type { Locator, Page } from "@playwright/test";
import { test, expect, connectZen } from "./harness";
import { tightHeaders } from "./tableHeaders";

const toggle = (scope: Page | Locator) => scope.getByRole("button", { name: /^Разница в / });
/** Режим переключателя — по его подписи: в самой кнопке невидимо лежит ещё и самый длинный вариант. */
const MODE = {
  money: /^Разница в деньгах\./,
  pct: /^Разница в процентах\./,
  both: /^Разница в деньгах и процентах\./,
};
const modeOf = async (t: Locator) => (await t.getAttribute("aria-label"))?.split(".")[0] ?? "";

/** Ячейки таблиц с заданными ширинами, чьё содержимое не влезает. */
async function clippedCells(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const table of document.querySelectorAll("table")) {
      if (getComputedStyle(table).tableLayout !== "fixed") continue;
      for (const td of table.querySelectorAll("tbody td")) {
        const el = td as HTMLElement;
        if (el.offsetWidth === 0) continue;
        for (const pill of el.querySelectorAll("span.rounded-full")) {
          const r = pill.getBoundingClientRect();
          const c = el.getBoundingClientRect();
          if (r.right > c.right + 0.5 || r.left < c.left - 0.5) out.push(pill.textContent ?? "");
        }
      }
    }
    return out;
  });
}

async function go(page: Page, to: string) {
  await page.evaluate((path) => {
    history.pushState(null, "", path);
    dispatchEvent(new PopStateEvent("popstate"));
  }, to);
  await page.waitForTimeout(350);
}

test("три режима по кругу и запоминаются для каждой таблицы", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page, "/categories");
  await page.getByRole("button", { name: "Полосы" }).click();
  const t = toggle(page);
  await expect(t).toHaveAttribute("aria-label", MODE.money);
  const pills = page.locator("table tbody td span.rounded-full", { hasText: /[▲▼]/ });
  await expect(pills.first()).toHaveText(/^[▲▼] [\d\s ]+₽$/);

  await t.click();
  await expect(t).toHaveAttribute("aria-label", MODE.pct);
  await expect(pills.first()).toHaveText(/%$/);
  await expect(pills.first()).not.toHaveText(/₽/);

  await t.click();
  await expect(t).toHaveAttribute("aria-label", MODE.both);
  await expect(pills.filter({ hasText: /₽ \((менее 1|\d+)%\)$/ }).first()).toBeVisible();

  // Режим «Сравнения» свой и не задет.
  await go(page, "/compare");
  await expect(toggle(page)).toHaveCount(2);
  await expect(toggle(page).last()).toHaveAttribute("aria-label", MODE.money);

  // После перезагрузки «Категории» помнят «₽ %».
  await page.reload();
  await page.waitForLoadState("networkidle");
  await go(page, "/categories");
  await page.getByRole("button", { name: "Полосы" }).click();
  await expect(toggle(page)).toHaveAttribute("aria-label", MODE.both);
});

/** Левые края всех столбцов таблицы, где стоит переключатель, и его самого. */
async function columnEdges(t: Locator): Promise<number[]> {
  return t.evaluate((btn) => {
    const table = btn.closest("table")!;
    const ths = [...table.querySelectorAll("thead th")].map((th) => Math.round(th.getBoundingClientRect().left));
    // Подпись рядом с кнопкой — по правому краю кнопки.
    return [...ths, Math.round(btn.getBoundingClientRect().right)];
  });
}

test("ни в одном режиме не режутся подписи и суммы, и столбцы не двигаются", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page, "/categories");
  const problems: string[] = [];
  const sweep = async (where: string, scope: Locator) => {
    const edges = await columnEdges(scope);
    for (let i = 0; i < 3; i++) {
      const mode = await modeOf(scope);
      for (const h of await tightHeaders(page)) problems.push(`${where} [${mode}] шапка: ${h}`);
      for (const c of await clippedCells(page)) problems.push(`${where} [${mode}] ячейка: ${c}`);
      const now = await columnEdges(scope);
      if (now.join() !== edges.join()) problems.push(`${where} [${mode}] столбцы сдвинулись: ${edges} → ${now}`);
      await scope.click();
      await page.waitForTimeout(150);
    }
  };

  await page.getByRole("button", { name: "Полосы" }).click();
  await sweep("/categories", toggle(page));

  await go(page, "/compare");
  await sweep("/compare метрики", toggle(page).first());
  await sweep("/compare категории", toggle(page).last());

  await go(page, "/recurring");
  await page.getByRole("tab", { name: "Планы DzenAnalytics" }).click();
  await expect(toggle(page)).toHaveCount(1);
  await sweep("/recurring", toggle(page));

  await go(page, "/anomalies");
  await page.getByRole("tab", { name: /Всплески/ }).click();
  await expect(toggle(page)).toHaveCount(1);
  await sweep("/anomalies всплески", toggle(page));

  expect(problems, problems.join("\n")).toEqual([]);
});
