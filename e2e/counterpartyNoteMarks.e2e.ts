/**
 * Значок заметки о контрагенте в других разделах (#128): заметка, заведённая в
 * «Контрагентах», видна у того же имени в ленте операций, в «Топе» и везде,
 * где в списке стоит это имя.
 */
import { test, expect, connectZen } from "./harness";

const NAME = "Пятёрочка";
const NOTE = "Карта лояльности на телефоне жены";

type NotesStore = { getState: () => { setNote: (name: string, text: string) => Promise<void> } };
type StoreWindow = { __store: (n: string) => Promise<Record<string, NotesStore>> };

async function go(page: import("@playwright/test").Page, path: string) {
  await page.evaluate((p) => {
    history.pushState({}, "", p);
    dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

test("значок заметки виден в ленте, «Топе» и других разделах", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connectZen(page, "/transactions");
  await page.evaluate(
    async ([name, note]) => {
      const { useCounterpartyNotesStore } = await (window as unknown as StoreWindow).__store(
        "useCounterpartyNotesStore"
      );
      await useCounterpartyNotesStore.getState().setNote(name, note);
    },
    [NAME, NOTE]
  );

  // Лента операций: у каждой строки «Пятёрочки» — значок, у других — нет.
  const payeeCells = page.locator("[data-cell='payee']");
  const withName = payeeCells.filter({ hasText: NAME });
  await expect(withName.first().locator("[data-note-mark]")).toBeVisible();
  expect(await withName.locator("[data-note-mark]").count()).toBe(await withName.count());
  expect(await payeeCells.locator("[data-note-mark]").count()).toBe(await withName.count());

  // Подсказка с текстом заметки.
  await withName.first().locator("[data-note-mark]").hover();
  await expect(page.getByText(NOTE)).toBeVisible();

  // «Топ»: строка контрагента со значком.
  await go(page, "/top");
  await page.locator("main").getByRole("button", { name: "Контрагенты", exact: true }).click();
  const topRow = page.locator("tr", { hasText: NAME }).first();
  await expect(topRow.locator("[data-note-mark]")).toBeVisible();

  // Остальные разделы: где «Пятёрочка» есть в списке — со значком, и ни один
  // раздел не падает.
  for (const path of ["/recurring", "/anomalies", "/digest"]) {
    await go(page, path);
    await expect(page.locator("main")).toBeVisible();
    const names = page.locator("main").getByText(NAME, { exact: true });
    const n = await names.count();
    for (let i = 0; i < n; i++) {
      await expect(names.nth(i).locator("xpath=..").locator("[data-note-mark]")).toHaveCount(1);
    }
  }
});
