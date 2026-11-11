/**
 * Итог синхронизации — той же плашкой внизу по центру, что «Отменить», и не
 * сбивает её. Выключатель всплывающих подсказок гасит пояснения при наведении.
 */
import { test, expect, connectZen } from "./harness";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1440, height: 900 });
});

const toastEl = (page: import("@playwright/test").Page) => page.locator("[data-toast]");
const syncBtn = (page: import("@playwright/test").Page) =>
  page.locator('button[title^="Синхронизация с Дзен-мани"]');

test("итог синхронизации — плашкой внизу по центру, со значком", async ({ page }) => {
  await connectZen(page, "/transactions");
  await syncBtn(page).click();
  const t = toastEl(page);
  await expect(t).toContainText("Без изменений.");
  // Без правок общее число операций не пишем — оно не изменилось.
  await expect(t).not.toContainText("Всего");
  await expect(t.locator("svg.text-income")).toHaveCount(1);
  await page.waitForTimeout(400);
  const box = (await t.boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - 720)).toBeLessThan(2);
  expect(box.y).toBeGreaterThan(700);
  if (process.env.E2E_SHOTS) await page.screenshot({ path: process.env.E2E_SHOTS + "/sync-toast.png", clip: { x: 360, y: 780, width: 720, height: 120 } });
});

test("итог синхронизации не сбивает «Отменить», а встаёт следом", async ({ page }) => {
  await connectZen(page, "/transactions");
  await page.locator(".op-row").first().getByRole("button", { name: "Удалить операцию" }).click();
  await expect(toastEl(page)).toContainText("Операция удалена");
  await syncBtn(page).click();
  await page.waitForTimeout(800);
  // «Отменить» на месте — синхронизация её не сбила.
  await expect(toastEl(page)).toContainText("Операция удалена");
  await toastEl(page).getByRole("button", { name: "Закрыть" }).click();
  await expect(toastEl(page)).toContainText("Без изменений");
});

test("«Всплывающие подсказки» выключены — пояснений при наведении нет", async ({ page }) => {
  await connectZen(page, "/transactions");
  const btn = syncBtn(page);
  await btn.hover();
  await expect(page.locator('[role="tooltip"]').filter({ hasText: "Синхронизация с Дзен-мани" })).toHaveCSS("opacity", "1");
  await page.mouse.move(5, 300);

  await page.evaluate(async () => {
    type S = { useDisplayStore: { getState: () => { setHints: (v: boolean) => Promise<void> } } };
    const { useDisplayStore } = await (window as unknown as { __store: (n: string) => Promise<S> }).__store("useDisplayStore");
    await useDisplayStore.getState().setHints(false);
  });
  await btn.hover();
  await page.waitForTimeout(500);
  const visible = await page.locator('[role="tooltip"]').evaluateAll((els) =>
    els.filter((e) => getComputedStyle(e).opacity !== "0" && (e.textContent ?? "").includes("Синхронизация")).length
  );
  expect(visible).toBe(0);
  // Серой системной подсказки тоже нет: `title` снят на время наведения.
  await expect(page.locator('button[data-native-title^="Синхронизация с Дзен-мани"]')).toHaveCount(1);
  await expect(page.locator('button[title^="Синхронизация с Дзен-мани"]')).toHaveCount(0);
});

test("плашка с отсчётом не заслоняет окно правки операции", async ({ page }) => {
  await connectZen(page, "/transactions");
  await page.locator(".op-row").first().getByRole("button", { name: "Удалить операцию" }).click();
  const t = toastEl(page);
  await expect(t).toContainText("Операция удалена");
  await page.locator(".op-row").nth(1).dblclick();
  await expect(page.getByRole("dialog")).toBeVisible();
  // В точке плашки сверху — окно правки, а не плашка.
  const box = (await t.boundingBox())!;
  const onTop = await page.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return { inToast: !!el?.closest("[data-toast]"), inDialog: !!el?.closest('[role="dialog"]') };
    },
    [box.x + box.width / 2, box.y + box.height / 2]
  );
  expect(onTop.inToast).toBe(false);
  expect(onTop.inDialog).toBe(true);
});
