/**
 * Обучение: знакомство само запускается при первых данных, подсвечивает
 * настоящие элементы, листается клавишами и запоминается; главы — из центра
 * обучения.
 */
import { test, expect, connectZen } from "./harness";

test("знакомство: само при первых данных, шаги по живой панели, запоминается", async ({ page, context }) => {
  // Сброс — один раз на вкладку: перезагрузка ниже должна видеть, что знакомство уже было.
  await context.addInitScript(() => {
    if (sessionStorage.getItem("tour-reset")) return;
    sessionStorage.setItem("tour-reset", "1");
    localStorage.setItem("dzenanalytics:tour", JSON.stringify({ done: [], welcomed: false }));
  });
  await connectZen(page, "/");
  const tour = page.getByRole("dialog", { name: /Обучение: Знакомство с панелью/ });
  await expect(tour.getByText("Добро пожаловать в DzenAnalytics")).toBeVisible({ timeout: 10_000 });

  await page.keyboard.press("ArrowRight");
  await expect(tour.getByText("Основные разделы")).toBeVisible();
  // Окно подсветки встало на меню разделов.
  const nav = await page.locator('[data-tour="nav"]').boundingBox();
  const spot = await page.locator(".tour-spot").boundingBox();
  await expect.poll(async () => (await page.locator(".tour-spot").boundingBox())?.x ?? 0).toBeLessThan(nav!.x + 1);
  expect(spot).toBeTruthy();

  // ← назад, Esc — закончить; второй раз само не запускается.
  await page.keyboard.press("ArrowLeft");
  await expect(tour.getByText("Добро пожаловать в DzenAnalytics")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tour).toHaveCount(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("dzenanalytics:tour") ?? "{}"));
  expect(saved.welcomed).toBe(true);
  await page.reload();
  await page.waitForTimeout(1500);
  await expect(page.getByRole("dialog", { name: /Обучение/ })).toHaveCount(0);
});

test("знакомство из справки сразу уводит на главную", async ({ page }) => {
  await connectZen(page, "/help");
  await page.getByRole("button", { name: "Обучение" }).click();
  await page.getByRole("dialog").filter({ hasText: "Центр обучения" }).getByRole("button", { name: /Знакомство с панелью/ }).click();
  await expect(page.getByText("Добро пожаловать в DzenAnalytics")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("центр обучения: глава «Главная, операции и фильтр» проходит до конца и отмечается", async ({ page }) => {
  await connectZen(page, "/help");
  await page.getByRole("button", { name: "Обучение" }).click();
  const hub = page.getByRole("dialog").filter({ hasText: "Центр обучения" });
  await expect(hub.getByText("Пройдено 0 из 3")).toBeVisible();
  await hub.getByRole("button", { name: /Главная, операции и фильтр/ }).click();

  const tour = page.getByRole("dialog", { name: /Обучение: Главная, операции и фильтр/ });
  await expect(tour.getByRole("heading", { name: "Главная" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  // К ленте: шаги 4–9 идут в «Операциях».
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await expect(tour.getByRole("heading", { name: "Общий фильтр" })).toBeVisible();
  await expect(page).toHaveURL(/\/transactions/);
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
  // Предпоследний шаг — в настройках оформления, на строке «Панель фильтров».
  await expect(tour.getByRole("heading", { name: "Фильтр можно спрятать" })).toBeVisible();
  await expect(page).toHaveURL(/tab=interface/);
  await expect(page.locator('[data-tour="filters-mode"]')).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await tour.getByRole("button", { name: "Готово" }).click();
  await expect(tour).toHaveCount(0);

  await page.keyboard.press("Control+k");
  await page.getByRole("button", { name: /^Центр обучения/ }).click();
  await expect(page.getByRole("dialog").filter({ hasText: "Центр обучения" }).getByText("Пройдено 1 из 3")).toBeVisible();
});

test("шаг «В карточке операции» открывает карточку и закрывает её, ничего не правя", async ({ page }) => {
  await connectZen(page, "/");
  await page.evaluate(async () => {
    type S = { useTourStore: { getState: () => { start: (id: string) => void; next: () => void } } };
    const m = await (window as unknown as { __store: (n: string) => Promise<S> }).__store("useTourStore");
    m.useTourStore.getState().start("daily");
    for (let i = 0; i < 8; i++) m.useTourStore.getState().next();
  });
  const tour = page.getByRole("dialog", { name: /Обучение/ });
  await expect(tour.getByRole("heading", { name: "В карточке операции" })).toBeVisible();
  await expect(page.locator('[data-tour="op-actions"]')).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('[data-tour="op-actions"]')).toHaveCount(0);
  const edits = await page.evaluate(async () => {
    type E = { useEditsStore: { getState: () => { edits: Record<string, unknown> } } };
    const m = await (window as unknown as { __store: (n: string) => Promise<E> }).__store("useEditsStore");
    return Object.keys(m.useEditsStore.getState().edits).length;
  });
  expect(edits).toBe(0);
});
