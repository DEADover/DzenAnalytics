/**
 * Смена расписания плана: «Изменить → Вся цепочка» → «каждую неделю по пн и
 * чт». При смене расписания сервер Дзен-мани сам стирает незакрытые даты
 * плана и новых не строит, поэтому в одном запросе уходят правило в формате
 * приложения (`day`/7/[0, 3]), новые даты с сегодняшнего дня и удаление
 * старых — включая просроченную.
 */
import { test, expect, connectZen, setPushMode } from "./harness";

test("расписание цепочки: правило, новые даты и удаление старых — одним запросом", async ({ page, zen }) => {
  await connectZen(page, "/transactions");
  await setPushMode(page, "manual");

  await page.getByRole("button", { name: /^Запланировано/ }).click();
  // Лента переключилась на одни планы — дальше она уже не перестраивается.
  await expect(page.getByRole("button", { name: /^Запланировано/ })).toHaveAttribute("aria-expanded", "true");
  // Любая дата «Фитнес-клуба»: новое расписание пересобирает всю цепочку.
  // Под нагрузкой меню строки может закрыться, пока лента дорисовывается, —
  // тогда открываем его заново.
  await expect(async () => {
    await page
      .getByText("Фитнес-клуб", { exact: true })
      .first()
      .locator("xpath=ancestor::*[.//button[@aria-label='Действия с запланированной операцией']][1]")
      .getByRole("button", { name: "Действия с запланированной операцией" })
      .click();
    await page.getByRole("button", { name: "Изменить", exact: true }).click({ timeout: 2000 });
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });

  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Вся цепочка", exact: true }).click();
  await expect(dialog.locator("[data-schedule-preview]")).toContainText("Каждый месяц");

  await dialog.getByRole("group", { name: "Период" }).getByRole("button", { name: "Неделя" }).click();
  const days = dialog.getByRole("group", { name: "Дни недели" });
  // План с 12.09 — суббота; выбираем пн и чт, субботу снимаем.
  await days.getByRole("button", { name: "пн" }).click();
  await days.getByRole("button", { name: "чт" }).click();
  await days.getByRole("button", { name: "сб" }).click();
  await expect(dialog.locator("[data-schedule-preview]")).toContainText("Каждую неделю, по пн и чт · ближайшие: 15.10");
  await expect(dialog.getByText(/Незакрытые даты плана, включая просроченные, заменятся/)).toBeVisible();
  await dialog.getByRole("button", { name: "Сохранить для цепочки" }).click();
  await expect(dialog).toHaveCount(0);

  await page.locator('button[title="Отправить изменения в Дзен-мани"]').click();
  await page.getByRole("dialog").getByRole("button", { name: "Отправить" }).click();
  await expect.poll(() => zen.pushes.length).toBe(1);

  const sent = zen.pushes[0];
  expect(sent.reminder).toEqual([
    expect.objectContaining({ id: "rem-gym", interval: "day", step: 7, points: [0, 3], startDate: "2026-09-14" }),
  ]);
  const dates = (sent.reminderMarker ?? []).map((m) => m.date).sort();
  expect(dates[0]).toBe("2026-10-15");
  expect(dates.slice(0, 4)).toEqual(["2026-10-15", "2026-10-19", "2026-10-22", "2026-10-26"]);
  expect((sent.reminderMarker ?? []).every((m) => m.reminder === "rem-gym" && m.state === "planned")).toBe(true);
  expect(new Set((sent.reminderMarker ?? []).map((m) => m.id)).size).toBe(dates.length);
  expect((sent.deletion ?? []).map((d) => `${d.object}:${d.id}`).sort()).toEqual([
    "reminderMarker:mk-2026-10",
    "reminderMarker:mk-2026-11",
    "reminderMarker:mk-2026-12",
  ]);
});
