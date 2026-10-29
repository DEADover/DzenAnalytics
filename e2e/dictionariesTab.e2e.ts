/**
 * «Справочники» в настройках открываются ровно: на большом справочнике
 * настройки категорий не перечитываются сотни раз (каждая точка категории
 * просила своё чтение — и список перерисовывался больше тысячи раз подряд),
 * а сам список вставляется, когда доиграло переключение вкладки.
 */
import { test, expect, connectZen } from "./harness";

test("«Справочники»: настройки категорий обновляются один раз, список появляется", async ({ page, zen }) => {
  zen.patchFull = (diff) => {
    const t0 = diff.tag[0]!;
    const tags = [] as typeof diff.tag;
    for (let i = 0; i < 60; i++) {
      tags.push({ ...t0, id: `big-${i}`, title: `Категория ${i}`, parent: null });
      for (let j = 0; j < 5; j++) tags.push({ ...t0, id: `big-${i}-${j}`, title: `Под ${i}.${j}`, parent: `big-${i}` });
    }
    return { ...diff, tag: [...diff.tag, ...tags] };
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page, "/settings");
  // Как после перезагрузки: настройки категорий ещё не прочитаны.
  await page.evaluate(async () => {
    type S = { useCategoryMetaStore: { setState: (x: unknown) => void; subscribe: (f: () => void) => () => void } };
    const { useCategoryMetaStore } = await (window as unknown as { __store: (n: string) => Promise<S> }).__store("useCategoryMetaStore");
    useCategoryMetaStore.setState({ loaded: false });
    (window as unknown as { __metaChanges: number }).__metaChanges = 0;
    useCategoryMetaStore.subscribe(() => (window as unknown as { __metaChanges: number }).__metaChanges++);
  });
  await page.getByRole("tab", { name: "Справочники" }).click();
  await expect(page.getByText("Категория 59").first()).toBeVisible();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { __metaChanges: number }).__metaChanges)).toBeLessThanOrEqual(1);
});

test("«Справочники»: строка поиска и шапка колонок не уезжают при прокрутке", async ({ page, zen }) => {
  zen.patchFull = (diff) => {
    const t0 = diff.tag[0]!;
    const tags = Array.from({ length: 120 }, (_, i) => ({ ...t0, id: `long-${i}`, title: `Категория ${i}`, parent: null }));
    const merchants = Array.from({ length: 300 }, (_, i) => ({ id: `m-${i}`, user: diff.user[0]!.id, title: `Магазин ${i}`, changed: 0 }));
    return { ...diff, tag: [...diff.tag, ...tags], merchant: [...(diff.merchant ?? []), ...merchants] as typeof diff.merchant };
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page, "/settings?tab=operations");

  for (const sub of ["Категории", "Контрагенты"]) {
    await page.getByRole("tab", { name: new RegExp(`^${sub}`) }).click();
    const bar = page.locator("[data-sticky-toolbar]");
    await expect(bar).toBeVisible();
    await page.waitForTimeout(400);
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(400);
    const headerH = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--app-header-h")) || 0);
    const barBox = (await bar.boundingBox())!;
    // Прилипла под шапкой сервиса и видна, поиск в ней — тоже.
    expect(Math.abs(barBox.y - headerH)).toBeLessThan(2);
    await expect(bar.getByRole("searchbox").or(bar.locator("input")).first()).toBeInViewport();
    // Шапка колонок — сразу под строкой поиска.
    const head = page.locator(".list-head").first();
    const headBox = (await head.boundingBox())!;
    expect(Math.abs(headBox.y - (barBox.y + barBox.height))).toBeLessThan(2);
    if (process.env.E2E_SHOTS)
      await page.screenshot({ path: `${process.env.E2E_SHOTS}/sticky-${sub}.png`, clip: { x: 0, y: 0, width: 1440, height: 320 } });
    await page.mouse.wheel(0, -6000);
    await page.waitForTimeout(300);
  }
});
