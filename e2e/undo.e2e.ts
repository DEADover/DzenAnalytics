/**
 * «Отменить» вместо «Вы уверены?»: удаление и правка выполняются сразу, а
 * плашка внизу даёт их отменить. Пока плашка висит, режим «Авто» ничего не
 * отправляет — отменённое не успевает уйти в облако.
 */
import type { Page } from "@playwright/test";
import { test, expect, connectZen, setPushMode } from "./harness";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

const toastEl = (page: Page) => page.locator("[data-toast]");

test("удаление: без окна-вопроса, с плашкой; «Отменить» возвращает операцию", async ({ page }) => {
  await connectZen(page, "/transactions");
  const firstText = () => page.locator(".op-row").first().innerText();
  const before = await firstText();
  await page.locator(".op-row").first().getByRole("button", { name: "Удалить операцию" }).click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(toastEl(page)).toContainText("Операция удалена");
  await expect.poll(firstText).not.toBe(before);
  if (process.env.E2E_SHOTS) {
    await page.waitForTimeout(400);
    await page.screenshot({ path: process.env.E2E_SHOTS + "/toast.png", clip: { x: 0, y: 700, width: 720, height: 200 } });
  }

  await toastEl(page).getByRole("button", { name: "Отменить" }).click();
  await expect(toastEl(page)).toContainText("Отменено");
  await expect.poll(firstText).toBe(before);
});

test("«Авто» ждёт плашку: отменённое удаление не уходит, неотменённое — уходит после неё", async ({ page, zen }) => {
  await connectZen(page, "/transactions");
  await setPushMode(page, "auto");
  const del = () => page.locator(".op-row").first().getByRole("button", { name: "Удалить операцию" }).click();
  const deletions = () => zen.pushes.reduce((n, p) => n + (p.deletion?.length ?? 0), 0);

  // Удалили и передумали: за всё время плашки и после — ни одной отправки.
  await del();
  await page.waitForTimeout(3000); // дольше обычной задержки «Авто» в 2 с
  expect(deletions()).toBe(0);
  await toastEl(page).getByRole("button", { name: "Отменить" }).click();
  await page.waitForTimeout(3000);
  expect(deletions()).toBe(0);

  // Удалили и не отменили — уходит, как только плашка ушла.
  await del();
  await page.waitForTimeout(3000);
  expect(deletions()).toBe(0);
  await expect.poll(deletions, { timeout: 10_000 }).toBe(1);
});

test("правка: ⌘Enter сохраняет, «Отменить» возвращает прежнее", async ({ page }) => {
  await connectZen(page, "/transactions");
  const row = page.locator(".op-row").first();
  await row.dblclick();
  const dialog = page.getByRole("dialog");
  const comment = dialog.locator("textarea").first();
  const before = await comment.inputValue();
  await comment.fill("Проверка отмены");
  await page.keyboard.press("ControlOrMeta+Enter");

  await expect(dialog).toHaveCount(0);
  await expect(toastEl(page)).toContainText("Операция сохранена");
  await expect(row).toContainText("Проверка отмены");

  // ⌘Z вне полей — то же «Отменить».
  await page.keyboard.press("ControlOrMeta+z");
  await expect(toastEl(page)).toContainText("Отменено");
  await expect(row).not.toContainText("Проверка отмены");
  if (before) await expect(row).toContainText(before.slice(0, 15));
});

test("«Без категории»: «К следующей» сохраняет и открывает следующую операцию", async ({ page, zen }) => {
  zen.patchFull = (diff) => {
    const base = diff.transaction[0]!;
    const uncat = (id: string, date: string, comment: string) => ({
      ...base,
      id,
      date,
      outcomeAccount: "acc-tbank",
      incomeAccount: "acc-tbank",
      outcome: 500,
      income: 0,
      tag: null,
      payee: null,
      merchant: null,
      comment,
    });
    return {
      ...diff,
      transaction: [...diff.transaction, uncat("tx-u1", "2026-10-12", "Первая"), uncat("tx-u2", "2026-10-11", "Вторая")],
    };
  };
  await connectZen(page, "/uncategorized");
  await page.locator(".op-row", { hasText: "Первая" }).getByRole("button", { name: "Открыть операцию" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("textarea").first()).toHaveValue("Первая");

  await dialog.getByRole("button", { name: "Без категории" }).click();
  await page.keyboard.type("Продукты");
  await page.keyboard.press("Enter");
  await dialog.getByRole("button", { name: "К следующей" }).click();

  // Окно на месте — уже со второй операцией; первая ушла из списка.
  await expect(dialog.locator("textarea").first()).toHaveValue("Вторая");
  await expect(toastEl(page)).toContainText("Операция сохранена");
  await expect(page.locator(".op-row", { hasText: "Первая" })).toHaveCount(0);
});
