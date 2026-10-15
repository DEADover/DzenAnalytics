/**
 * Окно операции: значок в ярлыке не сдвигает поле. «?» с курсом у суммы в чужой
 * валюте — кнопка 24 px, а строка ярлыка ниже; без поправки поле «Сумма»
 * уезжало ниже «Счёта» и «Валюты» в том же ряду.
 */
import { test, expect, connectZen } from "./harness";

test("поля «Счёт», «Сумма» и «Валюта» в одну линию и при значке курса", async ({ page }) => {
  await connectZen(page, "/transactions");
  await page.locator(`button[title="Добавить новую операцию"]`).first().click();
  await page.getByRole("menuitem", { name: "Расход" }).or(page.getByRole("button", { name: "Расход", exact: true })).first().click();
  const card = page.getByRole("dialog").filter({ hasText: "Новая операция" });
  await expect(card).toBeVisible();

  const account = card.getByPlaceholder("Выберите счёт");
  await account.fill("Валютный");
  await card.getByRole("option", { name: "Валютный счёт", exact: true }).click();
  await card.getByLabel("Сумма", { exact: true }).first().fill("10");
  await expect(card.getByRole("button", { name: "Курс и сумма в базовой валюте" })).toBeVisible();

  const tops = await Promise.all(
    [account, card.getByLabel("Сумма", { exact: true }).first(), card.getByRole("button", { name: "Валюта" })].map(async (l) =>
      Math.round((await l.boundingBox())!.y)
    )
  );
  if (process.env.E2E_SHOTS) await card.screenshot({ path: process.env.E2E_SHOTS + "/fx-row.png" });
  expect(new Set(tops).size, `поля ряда на разной высоте: ${tops.join(", ")}`).toBe(1);
});
