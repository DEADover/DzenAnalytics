/**
 * Заметки о контрагентах и должниках (#119): поле в карточке контрагента,
 * пометка в таблице, та же заметка у долга с этим именем, сохранение после
 * перезагрузки.
 */
import { test, expect, connectZen } from "./harness";

const NAME = "Кофейня у дома";

test("заметка: карточка контрагента, пометка в таблице и тот же человек в долгах", async ({ page, zen }) => {
  // Долг с тем же именем: занял «Кофейне у дома» 5 000 ₽.
  zen.patchFull = (diff) => {
    const base = diff.transaction[0]!;
    return {
      ...diff,
      account: [...diff.account, { ...diff.account[0]!, id: "acc-debt", title: "Долги", type: "debt", balance: 5_000 }],
      transaction: [
        ...diff.transaction,
        {
          ...base,
          id: "tx-debt-1",
          date: "2026-10-10",
          outcomeAccount: "acc-tbank",
          incomeAccount: "acc-debt",
          outcome: 5_000,
          income: 5_000,
          tag: null,
          payee: NAME,
          merchant: null,
          comment: null,
        },
      ],
    };
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connectZen(page, "/counterparties");

  const table = page.locator("table").first();
  const row = table.locator("tr", { hasText: NAME });
  await row.click();
  await expect(page.locator("[data-dossier-title]")).toHaveText(NAME);
  await expect(row.locator("[data-note-mark]")).toHaveCount(0);

  const field = page.getByLabel(`Заметка: ${NAME}`);
  await field.fill("Карта лояльности — каждый 6-й кофе бесплатно");
  // Сохраняется само, после паузы в наборе — пометка появляется в таблице.
  await expect(row.locator("[data-note-mark]")).toBeVisible();
  if (process.env.E2E_SHOTS) await page.locator("[data-place-card]").screenshot({ path: process.env.E2E_SHOTS + "/note-card.png" });
  if (process.env.E2E_SHOTS) await row.screenshot({ path: process.env.E2E_SHOTS + "/note-row.png" });

  // Другой контрагент — своё пустое поле; вернулись — заметка на месте.
  await table.locator("tr", { hasText: "Пятёрочка" }).click();
  await expect(page.getByLabel("Заметка: Пятёрочка")).toHaveValue("");
  await row.click();
  await expect(field).toHaveValue("Карта лояльности — каждый 6-й кофе бесплатно");

  // После перезагрузки — тоже.
  await page.reload();
  await row.click();
  await expect(page.getByLabel(`Заметка: ${NAME}`)).toHaveValue("Карта лояльности — каждый 6-й кофе бесплатно");

  // В долгах у того же имени — та же заметка: кнопка закрашена, правка видна в «Контрагентах».
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Показать контрагентов" }).first().click();
  const debtRow = page.locator("tr", { hasText: NAME }).filter({ hasText: /Должн/ });
  const noteBtn = debtRow.getByRole("button", { name: "Изменить заметку" });
  await expect(noteBtn).toBeVisible();
  await noteBtn.click();
  const popupField = page.getByLabel(`Заметка: ${NAME}`);
  await expect(popupField).toHaveValue("Карта лояльности — каждый 6-й кофе бесплатно");
  // Щелчок по заметке не открывает операции контрагента.
  await expect(page.getByRole("dialog", { name: /Операции/ })).toHaveCount(0);
  await popupField.fill("Вернёт до конца месяца");
  if (process.env.E2E_SHOTS) await page.screenshot({ path: process.env.E2E_SHOTS + "/note-popup.png", clip: { x: 500, y: 0, width: 940, height: 700 } });
  await page.getByRole("button", { name: "Готово" }).click();

  // Стёрли текст — заметки нет, кнопка снова пустая. Переход — внутри
  // приложения, без перезагрузки страницы.
  await page.evaluate(() => {
    history.pushState({}, "", "/counterparties");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await table.locator("tr", { hasText: NAME }).click();
  const again = page.getByLabel(`Заметка: ${NAME}`);
  await expect(again).toHaveValue("Вернёт до конца месяца");
  await again.fill("");
  await again.blur();
  await expect(table.locator("tr", { hasText: NAME }).locator("[data-note-mark]")).toHaveCount(0);
});
