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
  await row.getByRole("button", { name: "Изменить операцию" }).click();
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

test("копия с «Повторять операцию» становится регулярным планом", async ({ page, zen }) => {
  await connectZen(page, "/transactions");
  await setPushMode(page, "manual");

  const row = page.locator("div.grid", { hasText: "Кофейня у дома" }).filter({ hasText: "832" }).first();
  await row.getByRole("button", { name: "Изменить операцию" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Копировать операцию" }).click();
  const card = page.getByRole("dialog").filter({ hasText: "Копия операции" });
  await expect(card).toBeVisible();
  // Без переключателя — обычная операция, расписания не видно.
  await expect(card.getByRole("button", { name: "Создать", exact: true })).toBeVisible();
  await expect(card.locator("[data-schedule-preview]")).toHaveCount(0);

  await card.getByRole("switch", { name: "Повторять операцию" }).click();
  await expect(card.getByText("Первая дата плана")).toBeVisible();
  // Сегодня 15.10: каждый месяц, первая дата — из поля «Дата».
  await expect(card.locator("[data-schedule-preview]")).toContainText("15.10");
  await footerInOneRow(card);
  if (process.env.E2E_SHOTS) await card.screenshot({ path: process.env.E2E_SHOTS + "/repeat-plan.png" });
  await card.getByRole("button", { name: "Запланировать", exact: true }).click();
  await expect(card).toHaveCount(0);

  await page.locator('button[title="Отправить изменения в Дзен-мани"]').click();
  await page.getByRole("dialog").getByRole("button", { name: "Отправить" }).click();
  await expect.poll(() => zen.pushes.length).toBe(1);
  const sent = zen.pushes[0];
  // Операции нет — только план: правило «каждый месяц» и даты на год вперёд.
  expect(sent.transaction ?? []).toHaveLength(0);
  expect(sent.reminder).toEqual([
    expect.objectContaining({ interval: "month", step: 1, points: [0], startDate: "2026-10-15", endDate: null, outcome: 832, outcomeAccount: "acc-sber", tag: ["tag-cafe"] }),
  ]);
  const dates = (sent.reminderMarker ?? []).map((m) => m.date);
  expect(dates[0]).toBe("2026-10-15");
  expect(dates[1]).toBe("2026-11-15");
  expect(dates.length).toBeGreaterThanOrEqual(12);
  expect(new Set((sent.reminderMarker ?? []).map((m) => m.reminder))).toEqual(new Set([sent.reminder![0].id]));
});

test("«Повторять операцию» с датой в прошлом не сохраняется", async ({ page }) => {
  await connectZen(page, "/transactions");
  await setPushMode(page, "manual");
  const row = page.locator("div.grid", { hasText: "Кофейня у дома" }).filter({ hasText: "832" }).first();
  await row.getByRole("button", { name: "Изменить операцию" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Копировать операцию" }).click();
  const card = page.getByRole("dialog").filter({ hasText: "Копия операции" });
  await card.getByRole("switch", { name: "Повторять операцию" }).click();
  const date = card.getByLabel("Дата").first();
  await date.click();
  await date.fill("10.10.2026");
  await date.press("Enter");
  await card.getByRole("button", { name: "Запланировать", exact: true }).click();
  await expect(card.getByText(/не начинается в прошлом/)).toBeVisible();
});

for (const height of [1000, 740]) {
  test(`«Повторять операцию» не меняет комментарий и ширину полей (окно ${height})`, async ({ page }) => {
    await page.setViewportSize({ width: 1200, height });
    await connectZen(page, "/transactions");
    await setPushMode(page, "manual");
    await page.getByRole("button", { name: /Добавить/ }).first().click();
    await page.getByRole("menuitem", { name: "Расход" }).or(page.getByText("Расход", { exact: true })).first().click();
    const card = page.getByRole("dialog").filter({ hasText: "Новая операция" });
    const comment = card.locator("textarea");
    const sw = card.getByRole("switch", { name: "Повторять операцию" });
    await expect(sw).toBeVisible();
    // Окно въезжает с масштабом — мерить можно, когда оно встало.
    await page.waitForTimeout(500);
    const before = await comment.boundingBox();

    await sw.click();
    await expect(card.locator("[data-schedule-preview]")).toBeVisible();
    await page.waitForTimeout(500);
    const after = await comment.boundingBox();
    // Комментарий того же размера: расписание встало ниже, а не ужало его.
    expect(after!.height).toBe(before!.height);
    // Полоса прокрутки, если появилась, ширину полей не тронула.
    expect(after!.width).toBe(before!.width);
    // Переключатель стоит под комментарием, а не на нём; расписание видно.
    const swBox = await sw.boundingBox();
    expect(swBox!.y).toBeGreaterThanOrEqual(after!.y + after!.height);
    await expect(card.locator("[data-schedule-preview]")).toBeInViewport();
    if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/repeat-${height}.png` });

    // Выключили — всё как было.
    await sw.click();
    await page.waitForTimeout(300);
    expect((await comment.boundingBox())!.height).toBe(before!.height);
  });
}
