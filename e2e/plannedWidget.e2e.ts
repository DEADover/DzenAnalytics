/**
 * Виджет «Запланированные операции»: клик по строке открывает то же меню, что
 * в ленте. План можно сохранить как факт или связать с уже внесённой операцией,
 * и в Дзен-мани уходит ссылка на план.
 */
import type { Page } from "@playwright/test";
import { test, expect, connectZen, setPushMode } from "./harness";
import type { ZenDiffResponse, ZenTransaction } from "../src/lib/zenmoney";

const PLAN = "mk-2026-10";
const row = (page: Page) => page.locator(`[data-tour="widget-upcoming"] [data-plan-row="${PLAN}"]`);

async function openAction(page: Page, name: string) {
  // Меню закрывается прокруткой — сначала доводим строку до экрана.
  await row(page).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await expect(async () => {
    await row(page).click();
    await page.getByRole("button", { name, exact: true }).click({ timeout: 2000 });
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
}

async function send(page: Page) {
  await page.locator('button[title="Отправить изменения в Дзен-мани"]').click();
  await page.getByRole("dialog").getByRole("button", { name: "Отправить" }).click();
}

test("строка виджета: сохранить план как факт", async ({ page, zen }) => {
  await connectZen(page, "/");
  await setPushMode(page, "manual");
  await expect(row(page)).toBeVisible();

  await openAction(page, "Сохранить как факт");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Сохранить как факт", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row(page)).toHaveCount(0);

  await send(page);
  await expect.poll(() => zen.pushes.length).toBe(1);
  expect(zen.pushes[0].transaction).toEqual(
    expect.arrayContaining([expect.objectContaining({ reminderMarker: PLAN, outcome: 3_000 })])
  );
});

test("строка виджета: связать план с уже внесённой операцией", async ({ page, zen }) => {
  zen.patchFull = (diff: ZenDiffResponse) => {
    const sample = diff.transaction.find((t) => t.outcome > 0 && t.income === 0)!;
    const fact: ZenTransaction = {
      ...sample,
      id: "tx-gym-fact",
      date: "2026-10-13",
      tag: ["tag-home"],
      outcome: 3_000,
      income: 0,
      outcomeAccount: "acc-tbank",
      incomeAccount: "acc-tbank",
      comment: "Оплата абонемента",
      reminderMarker: null,
    };
    return { ...diff, transaction: [...diff.transaction, fact] };
  };
  await connectZen(page, "/");
  await setPushMode(page, "manual");
  await expect(row(page)).toBeVisible();

  await openAction(page, "Связать план с фактом");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /Оплата абонемента/ }).click();
  await dialog.getByRole("button", { name: "Связать", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row(page)).toHaveCount(0);

  await send(page);
  await expect.poll(() => zen.pushes.length).toBe(1);
  expect(zen.pushes[0].transaction).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: "tx-gym-fact", reminderMarker: PLAN })])
  );
});
