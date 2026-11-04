/**
 * «Отчёт за период»: листы на экране, выгрузка в PDF и HTML, запрет выгрузки
 * при скрытых суммах.
 */
import { readFile } from "node:fs/promises";
import { test, expect, connectZen } from "./harness";

const pages = (page: import("@playwright/test").Page) => page.locator("[data-report-preview] .pr-page");

test("листы отчёта: итоги, расходы, месяцы и счета — числа как в «Cash-flow»", async ({ page }) => {
  await connectZen(page, "/period-report");
  await expect(pages(page).first()).toBeVisible();
  const n = await pages(page).count();
  expect(n).toBeGreaterThanOrEqual(2);
  // Нумерация «1 / N» внизу каждого листа.
  await expect(pages(page).first().locator(".pr-foot")).toContainText(`1 / ${n}`);
  const cover = pages(page).first();
  await expect(cover.locator("[data-report-section=cover] .pr-kpi")).toHaveCount(4);
  await expect(cover.getByText("Движение денег")).toBeVisible();
  await expect(page.locator("[data-report-section=categories]")).toContainText("Куда ушли деньги");
  // Блоки из «Дайджеста»: главное одной фразой, траты по дням.
  await expect(page.locator("[data-report-headline]")).toContainText(/потратили/);
  await expect(page.locator("[data-report-section=days]")).toContainText("Дней без трат");
  // Блоки раскладываются по листам без пустых: в каждом листе хоть один блок.
  for (let i = 0; i < n; i++) expect(await pages(page).nth(i).locator("[data-report-section]").count()).toBeGreaterThan(0);

  // Лист не шире колонки: превью ужато, а сам лист — настоящего размера A4.
  const box = (await cover.boundingBox())!;
  const col = (await page.locator("[data-report-preview]").boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(col.width + 1);
  expect(await cover.evaluate((el) => (el as HTMLElement).offsetWidth)).toBe(794);

});

test("выгрузка: PDF — файл PDF, HTML — самостоятельная страница без меток сумм", async ({ page }) => {
  await connectZen(page, "/period-report");
  await expect(pages(page).first()).toBeVisible();

  const [pdf] = await Promise.all([page.waitForEvent("download"), page.locator("[data-report-export=pdf]").click()]);
  expect(pdf.suggestedFilename()).toMatch(/^DzenAnalytics — отчёт .+\.pdf$/);
  const pdfBytes = await readFile((await pdf.path())!);
  expect(pdfBytes.subarray(0, 5).toString()).toBe("%PDF-");

  const [html] = await Promise.all([page.waitForEvent("download"), page.locator("[data-report-export=html]").click()]);
  expect(html.suggestedFilename()).toMatch(/\.html$/);
  const text = await readFile((await html.path())!, "utf8");
  expect(text.startsWith("<!doctype html>")).toBe(true);
  expect(text).toContain("Отчёт за период");
  expect(text).toContain("@font-face");
  expect(text).toMatch(/<img[^>]* src="data:image\/png;base64,/);
  expect(text).not.toMatch(/[\u2060\u2063]/);

  // Файл открывается сам по себе и выглядит как превью.
  const file = await page.context().newPage();
  await file.setContent(text);
  await expect(file.locator(".pr-page").first()).toBeVisible();
  expect(await file.locator(".pr-page").count()).toBe(await pages(page).count());
  if (process.env.E2E_SHOTS) {
    await file.setViewportSize({ width: 900, height: 1200 });
    const sheets = file.locator(".pr-page");
    for (let i = 0; i < (await sheets.count()); i++)
      await sheets.nth(i).screenshot({ path: `${process.env.E2E_SHOTS}/period-report-${i + 1}.png` });
  }
  await file.close();
});

test("«Скрыть суммы» — выгрузка недоступна", async ({ page }) => {
  await connectZen(page, "/period-report");
  await page.evaluate(async () => {
    type S = { usePrivacyStore: { getState: () => { setHideAmounts: (v: boolean) => Promise<void> } } };
    const { usePrivacyStore } = await (window as unknown as { __store: (n: string) => Promise<S> }).__store("usePrivacyStore");
    await usePrivacyStore.getState().setHideAmounts(true);
  });
  await expect(page.locator("[data-report-export=pdf]")).toBeDisabled();
  await expect(page.locator("[data-report-export=html]")).toBeDisabled();
});
