/**
 * «Остатки по счетам»: вариант «Все (с внебалансовыми)» добавляет на график
 * счета вне баланса и открывает их в меню «Счета».
 */
import { test, expect, connectZen } from "./harness";

test("график остатков: «Все (с внебалансовыми)»", async ({ page, zen }) => {
  zen.patchFull = (diff) => ({
    ...diff,
    account: diff.account.map((a) => (a.id === "acc-save" ? { ...a, inBalance: false } : a)),
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectZen(page, "/accounts");
  const main = page.locator("main");
  const seg = main.getByRole("group", { name: "Накопительные счета на графике" });
  const allOff = seg.getByRole("button", { name: "Все (с внебалансовыми)" });
  await expect(allOff).toBeVisible();

  // Подпись не обрезана и в одну строку.
  const fit = await allOff.evaluate((el) => ({
    clipped: el.scrollWidth > el.clientWidth + 1,
    h: el.getBoundingClientRect().height,
    seg: el.parentElement!.getBoundingClientRect().height,
  }));
  expect(fit.clipped).toBe(false);
  expect(fit.h).toBeLessThan(fit.seg);

  const menuButton = main.getByRole("button", { name: /^Счета: Все$/ });
  // Заголовок меню — сколько счетов в нём предложено.
  const menuCount = (text: string) => page.getByText(text, { exact: true });

  // По умолчанию — только счета в балансе.
  await menuButton.click();
  await expect(menuCount("4 счёта")).toBeVisible();
  await page.keyboard.press("Escape");

  await allOff.click();
  await expect(allOff).toHaveAttribute("aria-pressed", "true");
  await menuButton.click();
  await expect(menuCount("5 счетов")).toBeVisible();
  await expect(page.getByText("Накопительный счёт", { exact: true }).last()).toBeVisible();
  await page.keyboard.press("Escape");

  // Назад к «Все» — внебалансовые снова не предлагаются.
  await seg.getByRole("button", { name: "Все", exact: true }).click();
  await menuButton.click();
  await expect(menuCount("4 счёта")).toBeVisible();
});
