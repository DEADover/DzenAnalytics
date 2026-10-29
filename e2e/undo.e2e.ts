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
    await page.screenshot({ path: process.env.E2E_SHOTS + "/toast.png", clip: { x: 400, y: 760, width: 640, height: 140 } });
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

type AnyStore = { getState: () => Record<string, (...a: unknown[]) => Promise<unknown>> & { loaded: boolean } };
type StoreWindow = { __store: (n: string) => Promise<Record<string, AnyStore>> };

test("правило: удаляется без вопроса, «Отменить» возвращает его на прежнее место", async ({ page }) => {
  await connectZen(page, "/rules");
  const rule = (title: string, value: string) => ({
    enabled: true,
    title,
    join: "and",
    conditions: [{ field: "comment", op: "contains", value, caseInsensitive: true }],
    actions: [{ kind: "prependComment", value: "[магазин]" }],
  });
  await page.evaluate(async (list) => {
    const { useCategoryRulesStore } = await (window as unknown as StoreWindow).__store("useCategoryRulesStore");
    if (!useCategoryRulesStore.getState().loaded) await useCategoryRulesStore.getState().hydrate();
    await useCategoryRulesStore.getState().addMany(list);
  }, [rule("Первое", "первое"), rule("Второе", "второе"), rule("Третье", "третье")]);

  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(3);
  await rows.nth(1).getByRole("button", { name: "Удалить правило" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(rows).toHaveCount(2);
  await expect(toastEl(page)).toContainText("Правило удалено");

  await toastEl(page).getByRole("button", { name: "Отменить" }).click();
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1)).toContainText("Второе");
});

test("цель: удаляется без вопроса, «Отменить» возвращает", async ({ page }) => {
  await connectZen(page, "/goals");
  await page.evaluate(async () => {
    const { useGoalsStore } = await (window as unknown as StoreWindow).__store("useGoalsStore");
    if (!useGoalsStore.getState().loaded) await useGoalsStore.getState().hydrate();
    await useGoalsStore.getState().add({ name: "Отпуск", target: 100_000, current: 0, deadline: null });
  });
  await expect(page.getByText("Отпуск").first()).toBeVisible();
  await page.getByRole("button", { name: "Удалить цель" }).first().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(toastEl(page)).toContainText("Цель «Отпуск» удалена");
  await expect(page.getByText("Отпуск")).toHaveCount(1); // только в плашке
  await toastEl(page).getByRole("button", { name: "Отменить" }).click();
  await expect(page.locator("main").getByText("Отпуск").first()).toBeVisible();
});

test("«Откатить все»: без вопроса, «Отменить» возвращает все неотправленные изменения", async ({ page }) => {
  await connectZen(page, "/transactions");
  await setPushMode(page, "manual");
  // Две правки: удаление и смена комментария.
  await page.locator(".op-row").first().getByRole("button", { name: "Удалить операцию" }).click();
  await page.locator(".op-row").first().dblclick();
  await page.getByRole("dialog").locator("textarea").first().fill("Откат и возврат");
  await page.keyboard.press("ControlOrMeta+Enter");

  // Счётчик в шапке: с правками — «Просмотреть…», без них — «Нет изменений…».
  const review = page.locator(
    'button[title^="Просмотреть изменения перед отправкой"], button[title="Нет изменений, ожидающих отправки"]'
  );
  await expect(review).toHaveText("2");
  await review.click();
  await page.getByRole("dialog").getByRole("button", { name: "Откатить все" }).click();
  await expect(toastEl(page)).toContainText("Откачены 2 изменения");
  await expect(review).toHaveText("0");

  await toastEl(page).getByRole("button", { name: "Отменить" }).click();
  await expect(review).toHaveText("2");
});

test("плашка: по центру снизу, над панелью выделения; отсчёт идёт и стоит на наведении", async ({ page }) => {
  await connectZen(page, "/transactions");
  // Выделили строку — внизу панель выделения; удалили другую — плашка над ней.
  await page.locator(".op-row").nth(1).click();
  const bar = page.getByRole("region", { name: "Массовые действия" });
  await expect(bar).toBeVisible();
  await page.locator(".op-row").nth(2).getByRole("button", { name: "Удалить операцию" }).click();

  const t = toastEl(page);
  await expect(t).toBeVisible();
  await page.waitForTimeout(400); // появление доиграло
  const box = (await t.boundingBox())!;
  const barBox = (await bar.boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - 720)).toBeLessThan(2);
  expect(box.y + box.height).toBeLessThanOrEqual(barBox.y);
  if (process.env.E2E_SHOTS)
    await page.screenshot({ path: process.env.E2E_SHOTS + "/toast-over-bar.png", clip: { x: 360, y: 680, width: 720, height: 220 } });

  const secs = () => t.locator("[data-countdown]").getAttribute("data-countdown").then(Number);
  expect(await secs()).toBe(6);
  await expect.poll(secs, { timeout: 3000 }).toBeLessThanOrEqual(4);
  // Мышь на плашке — отсчёт стоит.
  await t.hover();
  const held = await secs();
  await page.waitForTimeout(1500);
  expect(await secs()).toBe(held);
  await page.mouse.move(10, 10);
  await expect(t).toHaveCount(0, { timeout: 8000 });
});
