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

test("виджет под пустой клеткой поднимается в неё броском", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 2400 });
  await connectZen(page, "/");
  // «Категории» стоят в третьей клетке второго ряда — под пустой третьей первого.
  await page.evaluate(async () => {
    type Store = { getState: () => { replaceLayout: (raw: unknown) => Promise<void> } };
    const w = window as unknown as { __store: (n: string) => Promise<Record<string, Store>> };
    const { useDashboardLayoutStore } = await w.__store("useDashboardLayoutStore");
    await useDashboardLayoutStore.getState().replaceLayout([
      { key: "month", kind: "month" },
      { key: "accounts", kind: "accounts" },
      { key: "categories", kind: "categories", offset: 2 },
      ...["upcoming", "links", "cashflow", "activity", "observations"].map((k) => ({
        key: k,
        kind: k,
        hidden: true,
      })),
    ]);
  });
  await edit(page);
  expect(await rows(page)).toEqual(["month | accounts", "categories"]);
  const colOf = async (key: string) => Math.round((await tile(page, key).boundingBox())!.x);
  const col3 = await colOf("categories");

  await tile(page, "categories").dragTo(page.locator("[data-widget-gap]").first());
  await expect.poll(() => rows(page)).toEqual(["month | accounts | categories"]);
  expect(await colOf("categories")).toBe(col3);
});

test("список виджетов из полосы внизу страницы целиком помещается в окно", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 760 });
  await connectZen(page, "/");
  await edit(page);
  // Полоса «поставить сюда» в конце раскладки — у самого низа страницы.
  const strip = page.locator("[data-widget-gap]").last();
  await strip.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await strip.getByRole("button", { name: "Поставить сюда виджет" }).click();

  const dialog = page.getByRole("dialog", { name: "Поставить виджет" });
  await expect(dialog).toBeVisible();
  // Целиком в окне: и заголовок с крестиком, и нижний край — без прокрутки страницы.
  await expect(dialog).toBeInViewport({ ratio: 1 });
  const header = (await page.locator("header").first().boundingBox())!;
  expect((await dialog.boundingBox())!.y).toBeGreaterThanOrEqual(header.y + header.height);
  // Последний пункт достаётся прокруткой внутри списка, а не страницы.
  const last = dialog.getByRole("button", { name: /Тег под наблюдением/ });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport({ ratio: 1 });
  await last.click();
  await expect(page.locator('[data-widget-key="watchTag"]')).toBeVisible();
});

test("ручки виджета наблюдения стоят по центру, как у остальных", async ({ page }) => {
  await connectZen(page, "/");
  await page.evaluate(async () => {
    const w = window as unknown as {
      __store: (n: string) => Promise<Record<string, { getState: () => Record<string, unknown> }>>;
    };
    const { useDashboardLayoutStore } = await w.__store("useDashboardLayoutStore");
    const s = useDashboardLayoutStore.getState() as unknown as {
      add: (k: string) => Promise<void>;
      setCategory: (key: string, category: string) => Promise<void>;
    };
    await s.add("watch");
    await s.add("watch");
    await s.setCategory("watch", "Дом");
  });
  await edit(page);

  /** Насколько центр дорожки ручек отстоит от центра плитки, в долях её высоты. */
  const offCentre = async (key: string) => {
    const box = (await tile(page, key).boundingBox())!;
    const bar = (await tile(page, key).getByRole("button", { name: "Сдвинуть назад" }).boundingBox())!;
    return Math.abs(bar.y + bar.height / 2 - (box.y + box.height / 2)) / box.height;
  };
  expect(await offCentre("month")).toBeLessThan(0.05);
  expect(await offCentre("watch")).toBeLessThan(0.05);
  expect(await offCentre("watch-2")).toBeLessThan(0.05);

  // С выбранной категорией виджет приглушён, как остальные; без выбора — жив,
  // и категорию можно назвать, не выходя из настройки.
  await expect(tile(page, "watch").getByRole("button", { name: "Сменить категорию" })).toHaveCSS(
    "pointer-events",
    "none"
  );
  await tile(page, "watch-2").getByTestId("watch-picker").getByText("Выберите категорию").click();
  await page.getByRole("option", { name: "Продукты", exact: true }).click();
  await expect(tile(page, "watch-2")).toContainText("Продукты");
  expect(await offCentre("watch-2")).toBeLessThan(0.05);
});
