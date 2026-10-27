/**
 * «Без подкатегории»: под подкатегориями — строка с операциями самой
 * категории, чтобы подкатегории складывались в итог категории. Всегда
 * последней, по клику — именно эти операции.
 */
import type { Page } from "@playwright/test";
import { test, expect, connectZen } from "./harness";
import type { ZenTransaction } from "../src/lib/zenmoney";

async function withOwnTransport(page: Page, zen: { patchFull?: unknown }) {
  (zen as { patchFull: (d: { transaction: ZenTransaction[] }) => unknown }).patchFull = (diff) => {
    const taxi = diff.transaction.find((t) => t.tag?.includes("tag-taxi"))!;
    const own: ZenTransaction = {
      ...taxi,
      id: "tx-own-transport",
      date: "2026-10-09",
      outcome: 1_111,
      tag: ["tag-transport"],
      payee: "Парковка",
      comment: null,
    };
    return { ...diff, transaction: [...diff.transaction, own] };
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connectZen(page, "/categories");
}

test("кольцо: в развороте категории есть «Без подкатегории» последней строкой", async ({ page, zen }) => {
  await withOwnTransport(page, zen);
  const main = page.locator("main");
  await main.locator("tr", { hasText: "Транспорт" }).first().click();
  const rows = main.locator("tbody tr");
  await expect(rows.last()).toContainText("Без подкатегории");
  await expect(rows.last()).toContainText("1 111 ₽");
  await expect(main.locator("tr", { hasText: "Такси" })).toBeVisible();

  await rows.last().click();
  const drawer = page.getByRole("complementary");
  await expect(drawer.getByText("Транспорт / Без подкатегории").first()).toBeVisible();
  await expect(drawer.getByText("Парковка").first()).toBeVisible();
  await expect(drawer.getByRole("row", { name: /Яндекс Go/ })).toHaveCount(0);
});

test("полосы: «Без подкатегории» под подкатегориями", async ({ page, zen }) => {
  await withOwnTransport(page, zen);
  const main = page.locator("main");
  await main.getByRole("radio", { name: /Полосы/ }).or(main.getByRole("button", { name: /Полосы/ })).first().click();
  await main.locator("tr", { hasText: "Транспорт" }).first().getByRole("button").first().click();
  const own = main.locator("tr", { hasText: "Без подкатегории" });
  await expect(own).toContainText("1 111 ₽");
  const texts = await main.locator("tbody tr").allInnerTexts();
  const i = texts.findIndex((t) => t.includes("Без подкатегории"));
  expect(texts[i - 1]).toContain("Такси");
});
