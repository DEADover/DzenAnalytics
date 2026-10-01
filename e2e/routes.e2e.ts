/**
 * Каждый раздел открывается на выдуманном аккаунте: без падения, без ошибок в
 * консоли и с содержимым на месте.
 */
import { test, expect, connectZen } from "./harness";

export const ROUTES = [
  "/",
  "/transactions",
  "/accounts",
  "/categories",
  "/budgets",
  "/50-30-20",
  "/anomalies",
  "/calendar",
  "/cashflow",
  "/compare",
  "/digest",
  "/duplicates",
  "/dynamics",
  "/goals",
  "/health",
  "/help",
  "/import",
  "/recurring",
  "/report",
  "/rules",
  "/sankey",
  "/search",
  "/settings",
  "/tags",
  "/top",
  "/trash",
  "/trends",
  "/uncategorized",
  "/whatif",
  "/wordcloud",
  "/year-review",
];

test("все разделы открываются без ошибок", async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  let where = "/";
  page.on("pageerror", (e) => errors.push(`${where}: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`${where}: ${m.text()}`);
  });

  await connectZen(page);
  for (const route of ROUTES) {
    where = route;
    // Переход внутри приложения — как по меню: без перезагрузки и повторной
    // синхронизации.
    await page.evaluate((to) => {
      history.pushState(null, "", to);
      dispatchEvent(new PopStateEvent("popstate"));
    }, route);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.getByText("Что-то пошло не так")).toHaveCount(0);
    await page.waitForTimeout(300);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});
