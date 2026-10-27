/**
 * «Остатки по счетам»: тумблер «Учитывать внебалансовые» добавляет на график
 * счета вне баланса и открывает их в меню «Счета» и быстром выборе.
 */
import { test, expect, connectZen } from "./harness";

test("график остатков: «Учитывать внебалансовые»", async ({ page, zen }) => {
  zen.patchFull = (diff) => ({
    ...diff,
    account: diff.account.map((a) => (a.id === "acc-save" ? { ...a, inBalance: false } : a)),
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page, "/accounts");
  const main = page.locator("main");
  const seg = main.getByRole("group", { name: "Накопительные счета на графике" });
  const toggle = main.getByRole("switch", { name: "Учитывать внебалансовые счета на графике" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(main.getByText("Учитывать внебалансовые", { exact: true })).toBeVisible();

  const menuButton = main.getByRole("button", { name: /^Счета: Все$/ });
  const menuCount = (text: string) => page.getByText(text, { exact: true });

  // Выключен — только счета в балансе; единственный накопительный вне баланса.
  await expect(seg.getByRole("button", { name: "Накопления" })).toBeDisabled();
  await menuButton.click();
  await expect(menuCount("4 счёта")).toBeVisible();
  await page.keyboard.press("Escape");

  // Включён — счёт вне баланса в меню и в быстром выборе.
  await main.getByText("Учитывать внебалансовые", { exact: true }).click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(seg.getByRole("button", { name: "Все", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(seg.getByRole("button", { name: "Накопления" })).toBeEnabled();
  await menuButton.click();
  await expect(menuCount("5 счетов")).toBeVisible();
  await page.keyboard.press("Escape");

  // Выключили — меню снова без внебалансовых.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await menuButton.click();
  await expect(menuCount("4 счёта")).toBeVisible();
});
