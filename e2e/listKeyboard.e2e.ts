/**
 * Списки в окне операции листаются клавишами: ↑/↓ двигают подсветку, Enter
 * выбирает, у категории → открывает подкатегории, ← возвращает. Enter в
 * открытом списке выбирает пункт и не закрывает окно, Esc закрывает список, а
 * не окно.
 */
import { test, expect, connectZen, setPushMode } from "./harness";
import type { Locator, Page } from "@playwright/test";

/** Текст подсвеченного пункта — того, на который указывает `aria-activedescendant`. */
async function highlighted(page: Page, field: Locator): Promise<string> {
  const id = await field.getAttribute("aria-activedescendant");
  if (!id) return "";
  return (await page.locator(`[id="${id}"]`).innerText()).trim();
}

/** Жать ↓, пока подсветка не встанет на нужный пункт. */
async function arrowTo(page: Page, field: Locator, name: string): Promise<void> {
  for (let i = 0; i < 30; i++) {
    if ((await highlighted(page, field)) === name) return;
    await page.keyboard.press("ArrowDown");
  }
  throw new Error(`стрелками не дошли до «${name}», подсвечено «${await highlighted(page, field)}»`);
}

test("окно операции: счёт, категория с подкатегорией и место платежа выбираются клавишами", async ({ page, zen }) => {
  await connectZen(page, "/transactions");
  await setPushMode(page, "manual");
  const card = page.getByRole("dialog").filter({ hasText: "Новая операция" });
  // Смена режима отправки перерисовывает шапку — меню «Добавить» может
  // пересобраться прямо под щелчком, поэтому открываем его с повтором.
  await expect(async () => {
    await page.locator(`button[title="Добавить новую операцию"]`).first().click();
    await page.getByRole("menuitem", { name: "Расход" }).or(page.getByRole("button", { name: "Расход", exact: true })).first().click({ timeout: 2000 });
    await expect(card).toBeVisible({ timeout: 2000 });
  }).toPass();

  // Категория: ↓ на поле открывает список, фокус — в поиске.
  await card.getByRole("button", { name: "Выберите категорию" }).focus();
  await page.keyboard.press("ArrowDown");
  const catSearch = page.getByRole("combobox", { name: "Поиск категории" });
  await expect(catSearch).toBeFocused();
  await arrowTo(page, catSearch, "Транспорт");
  // Справа сразу подкатегории подсвеченной категории.
  await expect(page.getByRole("listbox", { name: "Подкатегории" }).getByRole("option", { name: "Такси" })).toBeVisible();
  // → — в подкатегории (первая — «Без подкатегории»), ← — назад, Enter — снова туда.
  await page.keyboard.press("ArrowRight");
  expect(await highlighted(page, catSearch)).toBe("Без подкатегории");
  await page.keyboard.press("ArrowLeft");
  expect(await highlighted(page, catSearch)).toBe("Транспорт");
  await page.keyboard.press("Enter");
  expect(await highlighted(page, catSearch)).toBe("Без подкатегории");
  await page.keyboard.press("ArrowDown");
  expect(await highlighted(page, catSearch)).toBe("Такси");
  await page.keyboard.press("Enter");
  await expect(card).toBeVisible();
  await expect(card.getByRole("button", { name: "Транспорт / Такси" })).toBeVisible();
  // Фокус вернулся на поле категории — с клавиатуры можно идти дальше.
  await expect(card.getByRole("button", { name: "Транспорт / Такси" })).toBeFocused();

  // Поиск категории: подсветка на первом найденном, Enter выбирает.
  await page.keyboard.press("Enter");
  await expect(catSearch).toBeFocused();
  await page.keyboard.type("Еда вне");
  expect(await highlighted(page, catSearch)).toBe("Еда вне дома");
  // Esc закрывает список, а не окно.
  await page.keyboard.press("Escape");
  await expect(catSearch).toHaveCount(0);
  await expect(card).toBeVisible();
  await expect(card.getByRole("button", { name: "Транспорт / Такси" })).toBeFocused();

  // Счёт: список открыт по фокусу, подсветка — на текущем счёте.
  const account = card.getByPlaceholder("Выберите счёт");
  const current = await account.inputValue();
  expect(current).toBe("Т-Банк");
  await account.focus();
  await expect(account).toHaveAttribute("aria-expanded", "true");
  expect(await highlighted(page, account)).toBe(current);
  // Счета по алфавиту, «Сбер» — прямо над «Т-Банком»; у края подсветка стоит.
  await page.keyboard.press("ArrowDown");
  expect(await highlighted(page, account)).toBe(current);
  await page.keyboard.press("ArrowUp");
  expect(await highlighted(page, account)).toBe("Сбер");
  await page.keyboard.press("Enter");
  await expect(card).toBeVisible();
  await expect(account).toHaveValue("Сбер");
  await expect(account).toHaveAttribute("aria-expanded", "false");
  // ↓ снова открывает закрытый список; Esc закрывает его, окно остаётся.
  await page.keyboard.press("ArrowDown");
  await expect(account).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(account).toHaveAttribute("aria-expanded", "false");
  await expect(card).toBeVisible();
  await expect(account).toHaveValue("Сбер");

  await card.getByLabel("Сумма", { exact: true }).first().fill("123");

  // Место платежа: набор — свободный ввод, без подсветки; ↓ встаёт на
  // первую подходящую подсказку, Enter её выбирает.
  const payee = card.getByPlaceholder("Введите или выберите из списка");
  await payee.focus();
  await page.keyboard.type("Пятёр");
  expect(await highlighted(page, payee)).toBe("");
  await page.keyboard.press("ArrowDown");
  expect(await highlighted(page, payee)).toBe("Пятёрочка");
  await page.keyboard.press("Enter");
  await expect(card).toBeVisible();
  await expect(payee).toHaveValue("Пятёрочка");

  await card.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(card).toHaveCount(0);

  await page.locator('button[title="Отправить изменения в Дзен-мани"]').click();
  await page.getByRole("dialog").getByRole("button", { name: "Отправить" }).click();
  await expect.poll(() => zen.pushes.length).toBe(1);
  const push = zen.pushes[0];
  const sent = (push.transaction ?? []) as unknown as {
    outcome: number;
    outcomeAccount: string;
    tag: string[] | null;
    merchant: string | null;
  }[];
  expect(sent).toEqual([
    expect.objectContaining({ outcome: 123, outcomeAccount: "acc-sber", tag: ["tag-taxi"] }),
  ]);
  // Место платежа уходит ссылкой на контрагента — тем же запросом.
  const merchant = (push.merchant ?? []).find((m) => m.id === sent[0].merchant);
  expect(merchant?.title).toBe("Пятёрочка");
});
