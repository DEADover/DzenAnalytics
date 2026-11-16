/**
 * Окно правила (#136): условие «Строка из выписки», счётчик отделяет операции,
 * где менять уже нечего, а в списке видно, по какому тексту операция подошла.
 */
import { test, expect, connectZen } from "./harness";

test("правило: строка из выписки, «уже соответствует» и причина совпадения", async ({ page }) => {
  await connectZen(page, "/rules");
  // Две операции банка «IKI»: у одной контрагент уже «Iki», у другой — как пришло.
  await page.evaluate(async () => {
    type T = { id: string; payee: string; payeeOriginal?: string; brand?: string; payeeRaw?: string | null; account: string };
    type S = { getState: () => { transactionsRaw: T[] }; setState: (p: { transactionsRaw: T[] }) => void };
    const store = (window as unknown as { __store: (n: string) => Promise<Record<string, S>> }).__store;
    const { useDataStore } = await store("useDataStore");
    const all = useDataStore.getState().transactionsRaw;
    const pick = all.filter((t) => t.payee === "Кофейня у дома").slice(0, 2).map((t) => t.id);
    useDataStore.setState({
      transactionsRaw: all.map((t) =>
        t.id === pick[0]
          ? { ...t, payee: "IKI", payeeOriginal: "IKI", brand: "Iki", payeeRaw: "IKI VILNIUS LT" }
          : t.id === pick[1]
            ? { ...t, payee: "IKI", payeeOriginal: "IKI", brand: undefined, payeeRaw: "IKI KAUNAS LT" }
            : t
      ),
    });
  });

  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  const editor = page.getByRole("dialog");
  await expect(editor).toBeVisible();

  // Поле условия называется «Контрагент», рядом в списке — «Строка из выписки».
  const field = editor.locator('[aria-label="Поле условия"]').first();
  await expect(field).toHaveText(/Контрагент/);
  await editor.getByLabel("Значение условия").first().fill("IKI");
  await editor.getByLabel("Без учёта регистра").first().uncheck();
  await expect(editor.getByText(/Подойд[её]т 2 операции/)).toBeVisible();

  // Действие «Контрагент = Iki»: одна операция уже такая.
  await editor.locator('[aria-label="Что менять"]').first().click();
  await page.getByRole("option", { name: "Контрагент" }).click();
  await editor.getByPlaceholder("Брокер").fill("Iki");
  await expect(editor.locator("[data-rule-settled]")).toHaveText(/1 уже соответствует/);
  await editor.getByRole("button", { name: "Показать" }).click();
  const list = editor.locator("#rule-matches");
  await expect(list.getByText("Уже соответствует", { exact: true })).toHaveCount(1);
  // В ленте у неё «Iki», а условие с учётом регистра сработало по тексту под именем.
  await expect(list.locator("[data-rule-hidden-match]")).toHaveText(/Совпало: «IKI»/);
  if (process.env.E2E_SHOTS) await editor.screenshot({ path: process.env.E2E_SHOTS + "/rule-statement.png" });

  // То же по строке из выписки: «KAUNAS» есть только у одной.
  await field.click();
  await page.getByRole("option", { name: "Строка из выписки" }).click();
  await editor.getByLabel("Значение условия").first().fill("KAUNAS");
  await expect(editor.getByText(/Подойд[её]т 1 операция/)).toBeVisible();
  await expect(list.locator("[data-rule-hidden-match]")).toHaveText(/Совпало: «IKI KAUNAS LT»/);
  // В «ТО» строки из выписки нет: её правило только читает.
  await editor.locator('[aria-label="Что менять"]').first().click();
  await expect(page.getByRole("option", { name: "Контрагент" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Строка из выписки" })).toHaveCount(0);
});
