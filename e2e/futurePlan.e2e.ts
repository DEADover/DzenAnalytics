/**
 * Операция с будущей датой — плановая, как в Дзен-мани (#120): копия на завтра
 * и позже уходит разовым планом, а не обычной операцией.
 */
import { test, expect, connectZen, setPushMode } from "./harness";

/** Кнопки подвала окна — в одну строку: длинная подпись не должна переносить ряд. */
async function footerInOneRow(card: import("@playwright/test").Locator) {
  const tops = await card.locator("button").evaluateAll((bs) =>
    bs
      .filter((b) => /Отмена|Создать|Запланировать/.test(b.textContent ?? ""))
      .map((b) => Math.round(b.getBoundingClientRect().top))
  );
  expect(tops.length).toBe(3);
  expect(new Set(tops).size, `кнопки подвала в разных строках: ${tops.join(", ")}`).toBe(1);
}

test("копия с будущей датой становится разовым планом", async ({ page, zen }) => {
  await connectZen(page, "/transactions");
  await setPushMode(page, "manual");

  const row = page.locator("div.grid", { hasText: "Кофейня у дома" }).filter({ hasText: "832" }).first();
  await row.getByRole("button", { name: "Редактировать операцию" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Копировать операцию" }).click();
  const card = page.getByRole("dialog").filter({ hasText: "Копия операции" });
  await expect(card).toBeVisible();
  // Сегодня (15.10) — обычная операция.
  await expect(card.getByRole("button", { name: "Создать", exact: true })).toBeVisible();
  await footerInOneRow(card);

  // На 20.10 — плановая: пометка у даты и другая кнопка.
  const date = card.getByLabel("Дата").first();
  await date.click();
  await date.fill("20.10.2026");
  await date.press("Enter");
  await expect(card.getByText("Будет плановой")).toBeVisible();
  await footerInOneRow(card);
  if (process.env.E2E_SHOTS) await card.screenshot({ path: process.env.E2E_SHOTS + "/future-plan.png" });
  await expect(card.getByRole("button", { name: "Запланировать ещё" })).toBeVisible();
  await card.getByRole("button", { name: "Запланировать", exact: true }).click();
  await expect(card).toHaveCount(0);

  await page.locator('button[title="Отправить изменения в Дзен-мани"]').click();
  await page.getByRole("dialog").getByRole("button", { name: "Отправить" }).click();
  await expect.poll(() => zen.pushes.length).toBe(1);
  const sent = zen.pushes[0];
  // Ни одной новой операции — только разовый план на 20.10.
  expect(sent.transaction ?? []).toHaveLength(0);
  expect(sent.reminder).toEqual([
    expect.objectContaining({ interval: null, step: 0, points: [0], startDate: "2026-10-20", endDate: "2026-10-20", outcome: 832, outcomeAccount: "acc-sber", tag: ["tag-cafe"] }),
  ]);
  // Получатель — ссылкой на контрагента, как у операций; новый уходит тем же запросом.
  const merchant = sent.reminder![0].merchant;
  expect(merchant).toBeTruthy();
  expect((sent.merchant ?? []).map((m) => m.id)).toContain(merchant);
  expect(sent.reminderMarker).toEqual([
    expect.objectContaining({ date: "2026-10-20", state: "planned", reminder: sent.reminder![0].id }),
  ]);
});
