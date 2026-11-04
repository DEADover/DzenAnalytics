/**
 * «Отчёт» в «Дайджесте»: выбор формата, выгрузка в PDF и HTML за выбранный
 * период, запрет выгрузки при скрытых суммах.
 */
import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { test, expect, connectZen } from "./harness";

const dialog = (page: Page) => page.getByRole("dialog").filter({ hasText: "Отчёт за" });

async function download(page: Page, format: "PDF" | "HTML") {
  await page.locator("[data-digest-report]").click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole("radio", { name: new RegExp(`^${format}`) }).click();
  const [file] = await Promise.all([page.waitForEvent("download"), dialog(page).locator("[data-report-download]").click()]);
  await expect(dialog(page)).toHaveCount(0);
  return file;
}

test("отчёт за месяц: PDF — файл PDF, HTML — самостоятельная страница с блоками отчёта", async ({ page }) => {
  await connectZen(page, "/digest");
  await page.locator("[data-digest-report]").click();
  await expect(dialog(page)).toContainText("Отчёт за октябрь 2026");
  await expect(dialog(page).getByRole("radio")).toHaveCount(2);
  await dialog(page).getByRole("button", { name: "Отмена" }).click();

  const pdf = await download(page, "PDF");
  expect(pdf.suggestedFilename()).toMatch(/^DzenAnalytics — отчёт 01\.10\.2026–31\.10\.2026\.pdf$/);
  expect((await readFile((await pdf.path())!)).subarray(0, 5).toString()).toBe("%PDF-");

  const html = await download(page, "HTML");
  const text = await readFile((await html.path())!, "utf8");
  expect(text.startsWith("<!doctype html>")).toBe(true);
  expect(text).toContain("Октябрь 2026");
  expect(text).toContain("@font-face");
  expect(text).toMatch(/<img[^>]* src="data:image\/png;base64,/);
  expect(text).not.toMatch(/[⁠⁣]/);
  // Листы за краем экрана после закрытия окна убраны.
  await expect(page.locator("[data-report-offscreen]")).toHaveCount(0);

  const file = await page.context().newPage();
  await file.setViewportSize({ width: 900, height: 1200 });
  await file.setContent(text);
  const sheets = file.locator(".pr-page");
  await expect(sheets.first()).toBeVisible();
  const n = await sheets.count();
  expect(n).toBeGreaterThanOrEqual(2);
  await expect(sheets.first().locator(".pr-foot")).toContainText(`1 / ${n}`);
  await expect(file.locator("[data-report-section=cover] .pr-kpi")).toHaveCount(4);
  // «Главное» — той же фразой, что в «Дайджесте».
  const headline = (await page.getByText(/^За \d+ дн/).first().innerText()).replace(/[⁠⁣]/g, "");
  expect((await file.locator("[data-report-headline]").innerText()).trim()).toBe(headline.trim());
  // Оформление графиков — атрибутами: снимок для PDF теряет стили классов
  // внутри SVG (подсказки ложились на график чёрной плашкой).
  expect(await file.locator(".pr-tip").evaluateAll((els) => els.every((e) => e.getAttribute("opacity") === "0"))).toBe(true);
  expect(await file.locator(".pr-chart text").evaluateAll((els) => els.every((e) => e.hasAttribute("font-size") || e.hasAttribute("fill")))).toBe(true);
  for (const key of ["days", "categories", "budget"]) await expect(file.locator(`[data-report-section=${key}]`)).toHaveCount(1);
  for (let i = 0; i < n; i++) {
    expect(await sheets.nth(i).locator("[data-report-section]").count()).toBeGreaterThan(0);
    expect(await sheets.nth(i).evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    if (process.env.E2E_SHOTS) await sheets.nth(i).screenshot({ path: `${process.env.E2E_SHOTS}/digest-report-${i + 1}.png` });
  }
  await file.close();
});

test("отчёт за неделю — без бюджета: план помесячный", async ({ page }) => {
  await connectZen(page, "/digest");
  await page.getByRole("radio", { name: "По неделям" }).or(page.getByRole("button", { name: "По неделям", exact: true })).first().click();
  const html = await download(page, "HTML");
  const text = await readFile((await html.path())!, "utf8");
  expect(text).toMatch(/Неделя \d/);
  expect(text).not.toContain('data-report-section="budget"');
  expect(text).toContain('data-report-section="days"');
});

test("«Скрыть суммы» — скачать нельзя, причина в окне", async ({ page }) => {
  await connectZen(page, "/digest");
  await page.evaluate(async () => {
    type S = { usePrivacyStore: { getState: () => { setHideAmounts: (v: boolean) => Promise<void> } } };
    const { usePrivacyStore } = await (window as unknown as { __store: (n: string) => Promise<S> }).__store("usePrivacyStore");
    await usePrivacyStore.getState().setHideAmounts(true);
  });
  await page.locator("[data-digest-report]").click();
  await expect(dialog(page).locator("[data-report-download]")).toBeDisabled();
  await expect(dialog(page).locator("[data-report-blocked]")).toContainText("Скрыть суммы");
});
