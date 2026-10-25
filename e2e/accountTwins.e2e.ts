/**
 * Счета с одинаковыми названиями: в Дзен-мани это обычное дело (два
 * «Т-Банка» в разных банках), у нас они склеивались в один. Теперь это два
 * счёта с уточнением в подписи, фильтр отбирает каждый отдельно, а перенос
 * операции на второй уходит в облако с его номером.
 */
import { test, expect, connectZen, setPushMode } from "./harness";

test("тёзки — два счёта: фильтр и перенос операции на второй", async ({ page, zen }) => {
  zen.patchFull = (diff) => ({
    ...diff,
    company: [
      { id: 1, title: "Тинькофф" },
      { id: 2, title: "Сбербанк" },
    ],
    account: diff.account.map((a) =>
      a.id === "acc-tbank"
        ? { ...a, company: 1 }
        : a.id === "acc-sber"
          ? { ...a, title: "Т-Банк", company: 2 }
          : a
    ),
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connectZen(page, "/transactions");

  // Фильтр «Счета»: две строки, каждая со своим банком.
  await page.getByRole("button", { name: /^Счета/ }).first().click();
  await expect(page.getByText("Т-Банк · Тинькофф", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Т-Банк · Сбербанк", { exact: true }).first()).toBeVisible();
  await page.keyboard.press("Escape");

  // Перенос операции с «Т-Банк · Тинькофф» на «Т-Банк · Сбербанк».
  await setPushMode(page, "on-sync");
  const row = page
    .locator("[data-cell='payee']")
    .filter({ hasText: "Пятёрочка" })
    .first()
    .locator("xpath=ancestor::*[.//button[@aria-label='Изменить операцию']][1]");
  await row.getByRole("button", { name: "Изменить операцию" }).click();
  const dialog = page.getByRole("dialog");
  const accountField = dialog.locator("input[value='Т-Банк · Тинькофф']");
  await expect(accountField).toBeVisible();
  await accountField.click();
  await accountField.fill("Сбер");
  await page.getByRole("option", { name: "Т-Банк · Сбербанк" }).click();
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();

  await page.locator('button[title^="Синхронизация с Дзен-мани"]').click();
  await expect.poll(() => zen.pushes.length).toBe(1);
  const tx = zen.pushes[0].transaction?.[0];
  expect(tx?.outcomeAccount).toBe("acc-sber");
  expect(tx?.incomeAccount).toBe("acc-sber");
});
