/**
 * Доступность: у каждой кнопки и ссылки в разделах есть имя (текст,
 * `aria-label` или подсказка), а подсказки `title` видны и с клавиатуры.
 */
import { test, expect, connectZen } from "./harness";
import { ROUTES } from "./routes";

test("во всех разделах нет кнопок и ссылок без имени", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page, "/");
  const found: string[] = [];
  for (const r of ROUTES) {
    await page.goto(r);
    await page.locator("[data-page-loading]").waitFor({ state: "detached" });
    await page.waitForTimeout(500);
    const bad = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('button, [role="button"], a[href]')]
        .filter((el) => el.offsetParent !== null)
        .filter((el) => {
          const by = el.getAttribute("aria-labelledby");
          const name =
            el.getAttribute("aria-label") ||
            (by && document.getElementById(by)?.textContent) ||
            el.getAttribute("title") ||
            el.getAttribute("data-native-title") ||
            (el.textContent || "").trim() ||
            el.querySelector("img[alt]")?.getAttribute("alt");
          return !name || !name.trim();
        })
        .map((el) => el.outerHTML.slice(0, 120))
    );
    for (const b of bad) found.push(`${r}: ${b}`);
  }
  expect(found).toEqual([]);
});

test("подсказка `title` видна при фокусе с клавиатуры", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page, "/transactions");
  const sync = page.locator('button[title^="Синхронизация с Дзен-мани"]');
  await sync.focus();
  // Фокус программный — как с клавиатуры, Tab: проверяем через :focus-visible.
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(page.locator('[role="tooltip"]').filter({ hasText: "Синхронизация с Дзен-мани" })).toHaveCSS("opacity", "1");
  // Имя у кнопки остаётся и пока `title` снят.
  await expect(page.locator('button[data-native-title^="Синхронизация с Дзен-мани"]')).toHaveAttribute("aria-label", /Синхронизация/);
});

test("у каждого поля ввода есть имя — в разделах и в окне операции", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page, "/");
  const scan = () =>
    page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          'input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea, [role=combobox]'
        ),
      ]
        .filter((el) => el.offsetParent !== null)
        .filter((el) => {
          const by = el.getAttribute("aria-labelledby");
          return !(
            el.getAttribute("aria-label") ||
            (by && document.getElementById(by)?.textContent?.trim()) ||
            (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) ||
            el.closest("label") ||
            el.getAttribute("title")
          );
        })
        .map((el) => el.outerHTML.slice(0, 120))
    );
  const found: string[] = [];
  for (const r of ROUTES) {
    await page.goto(r);
    await page.locator("[data-page-loading]").waitFor({ state: "detached" });
    await page.waitForTimeout(400);
    for (const b of await scan()) found.push(`${r}: ${b}`);
  }
  await page.goto("/transactions");
  await page.locator(".op-row").first().dblclick();
  await page.getByRole("dialog").waitFor();
  for (const b of await scan()) found.push(`окно операции: ${b}`);
  expect(found).toEqual([]);
});
