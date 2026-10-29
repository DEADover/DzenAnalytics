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
