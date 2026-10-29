/**
 * Пути к разбору месяца и к неразмеченным операциям — без лишних шагов:
 * кнопка на главной открывает идущий месяц в «Дайджесте», а «Без категории»
 * сразу показывает всю историю и общий период при этом не трогает.
 */
import { test, expect, connectZen } from "./harness";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("«Разбор месяца» с главной открывает идущий месяц в «Дайджесте»", async ({ page }) => {
  await connectZen(page, "/");
  await page.getByRole("link", { name: "Разбор месяца" }).first().click();
  await expect(page).toHaveURL(/\/digest\?month=2026-10$/);
  // Месяц ещё идёт — он в списке первым, выбран и подписан «Идёт».
  const first = page.locator("main button", { hasText: "Октябрь 2026" }).first();
  await expect(first).toContainText(/Идёт · день \d+ из 31/);
  await expect(page.getByText("Главное за Октябрь 2026")).toBeVisible();
  // Сравнение честное: с тем же числом дней, а не с целым месяцем.
  await expect(page.getByText(/сравниваем с тем же числом дней/)).toBeVisible();
});

test("«Без категории» сразу за всё время и общий период не меняет", async ({ page, zen }) => {
  // Операция без категории — полтора года назад, далеко за текущим месяцем.
  zen.patchFull = (diff) => {
    const base = diff.transaction[0]!;
    return {
      ...diff,
      transaction: [
        ...diff.transaction,
        {
          ...base,
          id: "tx-old-uncat",
          date: "2025-03-10",
          outcomeAccount: "acc-tbank",
          incomeAccount: "acc-tbank",
          outcome: 777,
          income: 0,
          tag: null,
          payee: "Старый ларёк",
          merchant: null,
          comment: null,
        },
      ],
    };
  };
  await connectZen(page, "/transactions");
  // Число в плитке «Операций» — за текущий общий период.
  const opsCount = () =>
    page.locator("main").evaluate((el) => (el as HTMLElement).innerText.match(/Операций\s*\n\s*([\d\s]+)/i)?.[1].trim());
  await expect.poll(opsCount).toBeTruthy();
  const before = await opsCount();

  // Переходы — внутри приложения: перезагрузка сбросила бы общий период сама.
  await page.getByRole("button", { name: "Ещё", exact: true }).click();
  await page.getByRole("link", { name: /^Без категории/ }).click();
  await expect(page.locator("main .op-row", { hasText: "Старый ларёк" })).toBeVisible();

  // Узкий период — пусто, и одна кнопка возвращает всё.
  await page.getByRole("button", { name: "Отчётный месяц" }).first().click();
  await expect(page.locator("main .op-row", { hasText: "Старый ларёк" })).toHaveCount(0);
  await page.getByRole("button", { name: "Показать за всё время" }).click();
  await expect(page.locator("main .op-row", { hasText: "Старый ларёк" })).toBeVisible();

  // Лента осталась на своём периоде.
  await page.getByRole("link", { name: "Операции", exact: true }).click();
  await expect.poll(opsCount).toBe(before);
});
