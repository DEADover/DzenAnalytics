/**
 * Перемещение виджетов в режиме «Настроить главную»: стрелками и мышью.
 *
 * Шаг стрелкой — соседнее место: рядом виджет — меняются местами, рядом
 * пустая клетка — виджет встаёт в неё. Бросок на другой виджет меняет двоих
 * местами, остальные стоят где стояли.
 */
import { test, expect, connectZen } from "./harness";
import type { Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

const tile = (page: Page, key: string) => page.locator(`[data-widget-key="${key}"]`);

/** Ряды главной слева направо, как их видно на экране. */
async function rows(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const items = [...document.querySelectorAll<HTMLElement>("[data-widget-key]")].map((el) => {
      const r = el.getBoundingClientRect();
      return { key: el.dataset.widgetKey!, top: Math.round(r.top + window.scrollY), left: r.left };
    });
    const byRow = new Map<number, typeof items>();
    for (const it of items) {
      const row = [...byRow.keys()].find((t) => Math.abs(t - it.top) < 8) ?? it.top;
      byRow.set(row, [...(byRow.get(row) ?? []), it]);
    }
    return [...byRow.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, list]) => list.sort((a, b) => a.left - b.left).map((x) => x.key).join(" | "));
  });
}

async function edit(page: Page) {
  await expect(tile(page, "month")).toBeVisible();
  await page.getByRole("button", { name: "Настроить главную" }).first().click();
}

const START = [
  "month | accounts | upcoming",
  "links",
  "cashflow | categories",
  "activity | observations",
];

test("стрелка меняет виджет с соседом с первого нажатия, без дыр", async ({ page }) => {
  await connectZen(page, "/");
  await edit(page);
  expect(await rows(page)).toEqual(START);

  await tile(page, "month").getByRole("button", { name: "Сдвинуть вперёд" }).click();
  await expect.poll(() => rows(page)).toEqual([
    "accounts | month | upcoming",
    "links",
    "cashflow | categories",
    "activity | observations",
  ]);
  await tile(page, "month").getByRole("button", { name: "Сдвинуть назад" }).click();
  await expect.poll(() => rows(page)).toEqual(START);

  // На краю раскладки шагать некуда.
  await expect(tile(page, "month").getByRole("button", { name: "Сдвинуть назад" })).toBeDisabled();
  await expect(tile(page, "observations").getByRole("button", { name: "Сдвинуть вперёд" })).toBeDisabled();
});

test("стрелка ставит виджет в пустую клетку ряда, сосед остаётся на месте", async ({ page }) => {
  await connectZen(page, "/");
  await edit(page);
  await tile(page, "upcoming").getByRole("button", { name: "Убрать с главной" }).click();
  await expect.poll(() => rows(page).then((r) => r[0])).toBe("month | accounts");

  const left = async (key: string) => Math.round((await tile(page, key).boundingBox())!.x);
  const col1 = await left("month");
  const col2 = await left("accounts");

  // «Балансы» уходят в третью клетку, «Итоги» не двигаются.
  await tile(page, "accounts").getByRole("button", { name: "Сдвинуть вперёд" }).click();
  await expect.poll(() => left("accounts")).toBeGreaterThan(col2 + 100);
  expect(await left("month")).toBe(col1);
  const col3 = await left("accounts");

  // «Итоги» шагают во вторую клетку — «Балансы» остаются в третьей.
  await tile(page, "month").getByRole("button", { name: "Сдвинуть вперёд" }).click();
  await expect.poll(() => left("month")).toBe(col2);
  expect(await left("accounts")).toBe(col3);
  expect((await rows(page))[0]).toBe("month | accounts");
});

test("бросок на другой виджет меняет двоих местами", async ({ page }) => {
  // Вся главная в одном экране: жест идёт без прокрутки страницы.
  await page.setViewportSize({ width: 1440, height: 2400 });
  await connectZen(page, "/");
  await edit(page);
  await tile(page, "observations").scrollIntoViewIfNeeded();
  await tile(page, "observations").dragTo(tile(page, "month"));
  await expect.poll(() => rows(page)).toEqual([
    "observations | accounts | upcoming",
    "links",
    "cashflow | categories",
    "activity | month",
  ]);

  // Раскладка сохранилась.
  await page.reload();
  await expect(tile(page, "month")).toBeVisible();
  expect(await rows(page)).toEqual([
    "observations | accounts | upcoming",
    "links",
    "cashflow | categories",
    "activity | month",
  ]);
});

test("бросок в пустую клетку ставит виджет ровно в неё", async ({ page }) => {
  // Вся главная в одном экране: жест идёт без прокрутки страницы.
  await page.setViewportSize({ width: 1440, height: 2400 });
  await connectZen(page, "/");
  await edit(page);
  await tile(page, "upcoming").getByRole("button", { name: "Убрать с главной" }).click();
  await expect.poll(() => rows(page).then((r) => r[0])).toBe("month | accounts");

  await tile(page, "observations").scrollIntoViewIfNeeded();
  await tile(page, "observations").dragTo(page.locator('[data-widget-gap]').first());
  await expect.poll(() => rows(page)).toEqual([
    "month | accounts | observations",
    "links",
    "cashflow | categories",
    "activity",
  ]);
});
