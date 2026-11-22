/**
 * «Категории» → «Полосы»: засечка и столбец сравнения — либо среднее, либо
 * план месяца из «Бюджета».
 */
import { test, expect, connectZen } from "./harness";

test("сравнение с планом месяца, а под фильтром — честное «нельзя»", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connectZen(page, "/categories");
  // Сразу по ссылке: планы бюджета раздел должен прочитать сам.
  await page.reload();
  await page.getByRole("button", { name: "Полосы" }).click();
  await expect(page.getByRole("columnheader", { name: /Среднее/ })).toBeVisible();

  await page.locator('[aria-label="С чем сравнивать категории"]').click();
  await page.getByRole("option", { name: "Планом месяца", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: /План/ })).toBeVisible();
  // В поддельном аккаунте план один: «Продукты», 25 000 ₽ на октябрь.
  const row = page.getByRole("row", { name: /Продукты/ }).first();
  await expect(row).toContainText(/25\s000/);
  await expect(page.getByTestId("plan-unavailable")).toHaveCount(0);
  // Статья без плана — прочерк, а не «перерасход на всю сумму».
  const noPlan = page.getByRole("row", { name: /Еда вне дома/ }).first();
  await expect(noPlan.locator("td").last()).toHaveText("—");
  // Засечка стоит на полосе и говорит, что это план.
  await expect(row.locator('[title*="План на"]')).toHaveCount(1);

  await page.evaluate(async () => {
    type S = { setState: (p: { accounts: Set<string> }) => void };
    const w = window as unknown as { __store: (n: string) => Promise<Record<string, S>> };
    const { useFiltersStore } = await w.__store("useFiltersStore");
    useFiltersStore.setState({ accounts: new Set(["acc-sber"]) });
  });
  await expect(page.getByTestId("plan-unavailable")).toContainText("План можно сравнить");
});
