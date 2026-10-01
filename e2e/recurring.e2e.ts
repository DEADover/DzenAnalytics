/**
 * «Сделать регулярной»: план по образцу операции — в очереди, в ленте и в
 * отправке правилом с датами на год вперёд.
 */
import { test, expect, connectZen, setPushMode } from "./harness";

test("операция становится планом: правило и 12 дат уходят в Дзен-мани", async ({ page, zen }) => {
  await connectZen(page, "/transactions");
  await setPushMode(page, "manual");

  // «Кофейня у дома» 14 октября — 832 ₽ со «Сбера». Уже просмотрена: открытие
  // непросмотренной само ставит отметку «просмотрено» — второе изменение.
  const row = page.locator("div.grid", { hasText: "Кофейня у дома" }).filter({ hasText: "832" }).first();
  await row.getByRole("button", { name: "Редактировать операцию" }).click();
  await page.getByRole("button", { name: "Сделать регулярной" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Сделать регулярной")).toBeVisible();
  // Ближайшая дата — через месяц после операции.
  await expect(dialog.getByText(/Каждый месяц · ближайшие: 14\.11/)).toBeVisible();
  await dialog.getByLabel(/^Сумма/).fill("600");
  if (process.env.E2E_SHOTS) await dialog.screenshot({ path: "/private/tmp/claude-501/-Users-sgryzhin-Claude-Projects-DzenAnalytics/c59bc0a7-ca1a-4645-bf5d-782b7d6d1b0a/scratchpad/recurring-modal.png" });
  await dialog.getByRole("button", { name: "Запланировать" }).click();
  await expect(dialog).toHaveCount(0);

  // План сразу в «Запланированных»: предстоящих было 4 (абонемент и аванс),
  // стало 16; до конца года — 4 + ноябрь и декабрь нового.
  const bar = page.getByRole("button", { name: /^Запланировано/ });
  await expect(bar).toContainText(/До конца года\s*6/);
  await expect(bar).toContainText(/Всего\s*16/);

  // В очереди — одно изменение, «Новый план».
  const review = page.locator('button[title^="Просмотреть изменения перед отправкой"]');
  await expect(review).toHaveText("1");
  await review.click();
  await expect(page.getByRole("dialog").getByText(/Каждый месяц с 14\.11.* · Новый план/)).toBeVisible();
  await page.keyboard.press("Escape");

  await page.locator('button[title="Отправить изменения в Дзен-мани"]').click();
  await page.getByRole("dialog").getByRole("button", { name: "Отправить" }).click();
  await expect.poll(() => zen.pushes.length).toBe(1);

  const sent = zen.pushes[0];
  expect(sent.reminder).toEqual([
    expect.objectContaining({
      interval: "month",
      step: 1,
      points: [0],
      startDate: "2026-11-14",
      endDate: null,
      outcome: 600,
      income: 0,
      outcomeAccount: "acc-sber",
      tag: ["tag-cafe"],
      payee: "Кофейня у дома",
    }),
  ]);
  const dates = (sent.reminderMarker ?? []).map((m) => m.date);
  expect(dates).toHaveLength(12);
  expect(dates[0]).toBe("2026-11-14");
  expect(dates[11]).toBe("2027-10-14");
  expect(new Set((sent.reminderMarker ?? []).map((m) => m.reminder))).toEqual(new Set([sent.reminder![0].id]));
  await expect(page.locator('button[title="Нет изменений, ожидающих отправки"]')).toHaveText("0");
});
