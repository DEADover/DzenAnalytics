import { test, expect, connectZen, FAKE_TOKEN } from "./harness";

/**
 * Синхронизация сломалась у человека: он должен увидеть, что делать, а автор
 * — получить отчёт с причиной. Раньше 401 мелькал тостом на 5 секунд, после
 * перезагрузки от него не оставалось следа, а войти заново можно было только
 * через «Отключить», стирающее кэш и неотправленные правки.
 */

const syncButton = (page: import("@playwright/test").Page) =>
  page.getByTitle(/^Синхронизация с Дзен-мани \(только изменения\)/);

test("токен перестал приниматься: «Войти заново» и замена без потери данных", async ({ page, zen }) => {
  await connectZen(page, "/transactions");
  zen.rejected.add(FAKE_TOKEN);

  await syncButton(page).click();
  const relogin = page.getByRole("button", { name: "Войти заново" });
  await expect(relogin).toBeVisible();

  // Сбой хранится, а не живёт до перезагрузки.
  await page.reload();
  await expect(relogin).toBeVisible();

  await relogin.click();
  await expect(page).toHaveURL(/\/settings\?tab=source&source=api/);
  await expect(page.getByText("Дзен-мани больше не принимает этот токен")).toBeVisible();

  // Токен другого аккаунта не принимаем: кэш и правки этого уехали бы туда.
  zen.owners.set("other-account-token", 777);
  const input = page.getByLabel("Новый токен Дзен-мани");
  await input.fill("other-account-token");
  await page.getByRole("button", { name: "Заменить токен" }).click();
  await expect(page.getByText(/Это токен другого аккаунта/)).toBeVisible();

  // Токен того же аккаунта — принят, синхронизация прошла, данные на месте.
  const pullsBefore = zen.pulls;
  await input.fill("same-account-new-token");
  await page.getByRole("button", { name: "Заменить токен" }).click();
  await expect(relogin).toBeHidden();
  expect(zen.pulls).toBeGreaterThan(pullsBefore);
  await page.goto("/transactions");
  await expect(page.getByText("Пятёрочка").first()).toBeVisible();
});

test("сбой повторяется — одна строка журнала со счётчиком, отчёт с шагом и кодом", async ({ page, zen, context }) => {
  await connectZen(page, "/transactions");
  zen.rejected.add(FAKE_TOKEN);

  await syncButton(page).click();
  await expect(page.getByRole("button", { name: "Войти заново" })).toBeVisible();
  await expect(syncButton(page)).toBeEnabled();
  await syncButton(page).click();
  await expect(syncButton(page)).toBeEnabled();

  await page.goto("/settings?tab=source&source=api");
  // Две одинаковые ошибки подряд — одна строка «×2», а не две.
  await expect(page.getByText("· ×2")).toBeVisible();

  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Скопировать отчёт" }).click();
  await expect(page.getByRole("button", { name: "Скопировано" })).toBeVisible();
  const report = await page.evaluate(() => navigator.clipboard.readText());
  expect(report).toContain("Шаг: Запрос изменений у Дзен-мани");
  expect(report).toContain("HTTP 401");
  expect(report).toContain("подряд: 2");
  expect(report).not.toContain(FAKE_TOKEN);
});
