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
  // Подпись под счётчиком говорит, что делать дальше, и зависит от режима.
  const next = editor.locator("[data-rule-next-step]");
  await expect(next).toContainText("«Проверить и применить» над списком правил");
  await editor.getByRole("radio", { name: "Выкл" }).click();
  await expect(next).toContainText("Правило выключено");
  await editor.getByRole("radio", { name: "По кнопке" }).click();

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
  await expect(first.locator("div.truncate")).toHaveText([
    "Дата: 2 мая 2026 г. · Тип операции: Расход",
    "Категория: Еда вне дома",
    "Контрагент: Iki (IKI) · В выписке: IKI VILNIUS LT",
  ]);
  await expect(first.locator("[data-rule-mark]")).toHaveText(["IKI"]);
  // Текст под именем слово в слово повторяет строку из выписки — рядом с именем
  // его нет, а подсветка условия «Контрагент» стоит в строке «В выписке».
  const third = list.locator("[data-rule-match]").filter({ hasText: "IKI SIAULIAI LT" });
  await expect(third).toHaveCount(1);
  await expect(third.locator("[data-rule-payee]")).toHaveText("Контрагент: Iki");
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

test("список совпадений раскрывается пачками по 50", async ({ page }) => {
  await connectZen(page, "/rules");
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  const editor = page.getByRole("dialog");
  // «о» есть в большинстве названий — совпадений больше пятидесяти.
  await editor.getByLabel("Значение условия").first().fill("о");
  await editor.getByRole("button", { name: "Показать" }).click();
  const list = editor.locator("#rule-matches");
  const rows = list.locator("[data-rule-match]");
  await expect(rows).toHaveCount(50);
  const total = Number(((await list.textContent()) ?? "").match(/Показаны первые 50 из (\d+)/)?.[1]);
  expect(total).toBeGreaterThan(50);
  const more = list.getByRole("button", { name: "Посмотреть ещё" });
  await more.click();
  await expect(rows).toHaveCount(Math.min(100, total));
  // Показано всё — кнопки больше нет.
  if (total <= 100) await expect(more).toHaveCount(0);
  // Условие поменялось — список снова с первой пачки.
  await editor.getByLabel("Значение условия").first().fill("а");
  await expect(rows).toHaveCount(50);
});

test("«Что изменят правила»: операция с подписями, «К записи» идёт за отметками", async ({ page }) => {
  await connectZen(page, "/rules");
  await page.evaluate(async () => {
    type S = { getState: () => { addMany: (r: unknown[]) => Promise<string[]>; hydrate: () => Promise<void>; loaded: boolean } };
    const store = (window as unknown as { __store: (n: string) => Promise<Record<string, S>> }).__store;
    const { useCategoryRulesStore } = await store("useCategoryRulesStore");
    if (!useCategoryRulesStore.getState().loaded) await useCategoryRulesStore.getState().hydrate();
    await useCategoryRulesStore.getState().addMany([
      {
        enabled: true,
        autoApply: false,
        title: "Пятёрочка — пометка",
        join: "and",
        conditions: [{ field: "payee", op: "equals", value: "Пятёрочка", caseInsensitive: true }],
        actions: [{ kind: "setComment", value: "Тест" }],
      },
    ]);
  });
  await page.getByRole("button", { name: /Проверить и применить/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "Что изменят правила" });
  await expect(dialog).toBeVisible();

  // Операция — строками с подписями; изменение — отдельным блоком под ними.
  const firstRow = dialog.locator("[data-rule-changes]").first().locator("xpath=..");
  await expect(firstRow).toContainText(/Дата: \d+ \S+ 2026 г\. · Тип операции: Расход/);
  await expect(firstRow).toContainText("Категория: Продукты");
  await expect(firstRow).toContainText("Контрагент: Пятёрочка");
  await expect(firstRow.locator("[data-rule-changes]")).toContainText("Комментарий:");
  await expect(firstRow.locator("[data-rule-changes]")).toContainText("Тест");

  // «К записи» в шапке — сколько запишет кнопка: сняли отметку — стало меньше.
  const toWrite = dialog.locator("[data-rule-to-write]");
  const total = Number((await toWrite.textContent())?.replace(/\s/g, ""));
  expect(total).toBeGreaterThan(1);
  await dialog.getByRole("checkbox", { name: /^Выбрать операцию/ }).first().uncheck();
  await expect(toWrite).toHaveText(String(total - 1));
  await expect(dialog.getByRole("button", { name: `Применить правила (${total - 1})` })).toBeVisible();

  // Про отмену в списке изменений окно больше не пишет.
  await expect(dialog).not.toContainText("Отменить можно построчно");
  if (process.env.E2E_SHOTS) await dialog.screenshot({ path: process.env.E2E_SHOTS + "/rule-preview.png" });
});
