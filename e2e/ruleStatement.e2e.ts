/**
 * Окно правила (#136): условие «Строка из выписки», счётчик отделяет операции,
 * где менять уже нечего, а в списке видно, по какому тексту операция подошла.
 */
import { test, expect, connectZen } from "./harness";

test("правило: строка из выписки, «уже соответствует» и причина совпадения", async ({ page }) => {
  await connectZen(page, "/rules");
  // Две операции банка «IKI»: у одной контрагент уже «Iki», у другой — как пришло.
  await page.evaluate(async () => {
    type T = { id: string; comment?: string; payee: string; payeeOriginal?: string; brand?: string; payeeRaw?: string | null; account: string };
    type S = { getState: () => { transactionsRaw: T[] }; setState: (p: { transactionsRaw: T[] }) => void };
    const store = (window as unknown as { __store: (n: string) => Promise<Record<string, S>> }).__store;
    const { useDataStore } = await store("useDataStore");
    const all = useDataStore.getState().transactionsRaw;
    const pick = all.filter((t) => t.payee === "Кофейня у дома").slice(0, 3).map((t) => t.id);
    useDataStore.setState({
      transactionsRaw: all.map((t) =>
        t.id === pick[0]
          ? { ...t, payee: "IKI", payeeOriginal: "IKI", brand: "Iki", payeeRaw: "IKI VILNIUS LT" }
          : t.id === pick[1]
            ? { ...t, payee: "IKI", payeeOriginal: "IKI", brand: undefined, payeeRaw: "IKI KAUNAS LT", comment: "Кофе на вынос" }
            : t.id === pick[2]
              ? { ...t, payee: "IKI SIAULIAI LT", payeeOriginal: "IKI SIAULIAI LT", brand: "Iki", payeeRaw: "IKI SIAULIAI LT" }
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
  await expect(editor.getByText(/Подойд[её]т 3 операции/)).toBeVisible();

  // Действие «Контрагент = Iki»: одна операция уже такая.
  await editor.locator('[aria-label="Что менять"]').first().click();
  await page.getByRole("option", { name: "Контрагент" }).click();
  await editor.getByPlaceholder("Брокер").fill("Iki");
  await expect(editor.locator("[data-rule-settled]")).toHaveText(/2 уже соответствуют/);
  await editor.getByRole("button", { name: "Показать" }).click();
  const list = editor.locator("#rule-matches");
  await expect(list.getByText("Уже соответствует", { exact: true })).toHaveCount(2);
  // В строке — имя, текст под ним и строка из выписки; подсвечено то, на чём
  // сошлось условие: «Iki» с учётом регистра не подходит, подошёл текст «IKI».
  const first = list.locator("[data-rule-match]").first();
  await expect(first).toContainText("Iki · IKI");
  await expect(first.locator("[data-rule-statement]")).toHaveText("В выписке: IKI VILNIUS LT");
  await expect(first.locator("[data-rule-mark]")).toHaveText(["IKI"]);
  // Текст под именем слово в слово повторяет строку из выписки — рядом с именем
  // его нет, а подсветка условия «Контрагент» стоит в строке «В выписке».
  const third = list.locator("[data-rule-match]").filter({ hasText: "IKI SIAULIAI LT" });
  await expect(third).toHaveCount(1);
  await expect(third.locator("div.truncate").first()).toHaveText("Iki");
  await expect(third.locator("[data-rule-statement] [data-rule-mark]")).toHaveText(["IKI"]);

  // То же по строке из выписки: «KAUNAS» есть только у одной.
  await field.click();
  await page.getByRole("option", { name: "Строка из выписки" }).click();
  await editor.getByLabel("Значение условия").first().fill("KAUNAS");
  await expect(editor.getByText(/Подойд[её]т 1 операция/)).toBeVisible();
  await expect(list.locator("[data-rule-mark]")).toHaveText(["KAUNAS"]);
  // Комментарий виден в строке и подсвечивается своим условием.
  await editor.locator("button", { hasText: /^\s*Условие\s*$/ }).first().click();
  await editor.locator('[aria-label="Поле условия"]').last().click();
  await page.getByRole("option", { name: "Комментарий" }).click();
  await editor.getByLabel("Значение условия").last().fill("на вынос");
  await expect(list.locator("[data-rule-comment]")).toHaveText("Комментарий: Кофе на вынос");
  await expect(list.locator("[data-rule-mark]")).toHaveText(["KAUNAS", "на вынос"]);
  await list.scrollIntoViewIfNeeded();
  if (process.env.E2E_SHOTS) await editor.screenshot({ path: process.env.E2E_SHOTS + "/rule-statement.png" });
  // В «ТО» строки из выписки нет: её правило только читает.
  await editor.locator('[aria-label="Что менять"]').first().click();
  await expect(page.getByRole("option", { name: "Контрагент" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Строка из выписки" })).toHaveCount(0);
});
