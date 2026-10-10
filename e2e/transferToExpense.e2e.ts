/**
 * Перевод → расход в карточке операции: категория «Перевод» не переезжает в
 * расход, нужные поля подсвечены, а место платежа доезжает до Дзен-мани.
 */
import { test, expect, connectZen, setPushMode } from "./harness";

test("перевод стал расходом: поля подсвечены, категория обязательна, место платежа уходит в Дзен-мани", async ({ page, zen }) => {
  await connectZen(page, "/transactions");
  await setPushMode(page, "auto");
  await page.locator(".op-row, [data-cell]").filter({ hasText: "В накопления" }).first().dblclick();
  const card = page.getByRole("dialog").filter({ hasText: "Редактирование операции" });
  await card.getByText("Расход", { exact: true }).click();

  // Категория пуста, а не «Перевод»; оба поля подсвечены.
  await expect(card.getByRole("button", { name: "Выберите категорию" })).toBeVisible();
  await expect(card.getByText("Выберите — у перевода её не было")).toBeVisible();
  await expect(card.getByText("У перевода его не было — укажите, если нужно")).toBeVisible();

  // Без категории не сохраняется.
  await card.getByRole("button", { name: "Сохранить" }).click();
  await expect(card.getByText("Выберите категорию: у перевода её не было")).toBeVisible();

  await card.getByRole("button", { name: "Выберите категорию" }).click();
  await page.locator("button").filter({ hasText: /^Продукты$/ }).last().click();
  await expect(card.getByText("Выберите — у перевода её не было")).toHaveCount(0);
  const payee = card.getByPlaceholder("Введите или выберите из списка");
  await payee.fill("Ларёк у дома");
  await page.keyboard.press("Enter");
  await expect(card.getByText("У перевода его не было — укажите, если нужно")).toHaveCount(0);
  await card.getByRole("button", { name: "Сохранить" }).click();
  await expect(card).toHaveCount(0);

  await expect.poll(() => zen.pushes.length, { timeout: 10_000 }).toBeGreaterThan(0);
  const sent = (zen.pushes.at(-1) as { transaction?: { comment: string | null; payee: string | null; merchant: string | null; tag: string[] | null }[] }).transaction ?? [];
  const op = sent.find((t) => t.comment === "В накопления");
  expect(op).toMatchObject({ payee: "Ларёк у дома", merchant: null, tag: ["tag-food"] });
});
