/**
 * Копирование правила и запрет второго такого же: копия открывается в
 * редакторе, пока она повторяет оригинал — «Создать» недоступна; после правки
 * копия встаёт сразу под оригиналом. Повторы, пришедшие в список не из
 * редактора, помечены значком.
 */
import { test, expect, connectZen } from "./harness";

type RulesStore = {
  getState: () => {
    addMany: (r: unknown[]) => Promise<string[]>;
    replaceAll: (r: unknown[]) => Promise<void>;
    hydrate: () => Promise<void>;
    loaded: boolean;
    rules: { id: string; title?: string; groups: { conditions: { value: string }[] }[] }[];
  };
};
type StoreWindow = { __store: (n: string) => Promise<Record<string, RulesStore>> };

const rule = (title: string, payee: string) => ({
  enabled: true,
  title,
  join: "and",
  conditions: [{ field: "comment", op: "contains", value: payee, caseInsensitive: true }],
  actions: [{ kind: "prependComment", value: "[магазин]" }],
});

test("копия правила: повтор не сохранить, исправленная встаёт под оригиналом", async ({ page }) => {
  await connectZen(page, "/rules");
  await page.evaluate(
    async (list) => {
      const { useCategoryRulesStore } = await (window as unknown as StoreWindow).__store("useCategoryRulesStore");
      if (!useCategoryRulesStore.getState().loaded) await useCategoryRulesStore.getState().hydrate();
      await useCategoryRulesStore.getState().addMany(list);
    },
    [rule("Пятёрочка", "пятёрочка"), rule("Магнит", "магнит")]
  );

  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await rows.first().getByRole("button", { name: "Копировать правило" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Копия правила");
  await expect(dialog.locator("input[value='Пятёрочка (копия)']")).toBeVisible();
  const create = dialog.getByRole("button", { name: "Создать" });
  await expect(create).toBeDisabled();
  await expect(dialog.locator("[data-rule-blocker]")).toHaveText("Такое правило уже есть — № 1");

  // Правка условия в повтор другого правила — тоже нельзя.
  const value = dialog.locator("input[value='пятёрочка']");
  await value.fill("магнит");
  await expect(dialog.locator("[data-rule-blocker]")).toHaveText("Такое правило уже есть — № 2");
  await expect(create).toBeDisabled();

  await dialog.locator("input[value='магнит']").fill("лента");
  await expect(dialog.locator("[data-rule-blocker]")).toHaveCount(0);
  await create.click();
  await expect(dialog).toBeHidden();

  const titles = await page.evaluate(async () => {
    const { useCategoryRulesStore } = await (window as unknown as StoreWindow).__store("useCategoryRulesStore");
    return useCategoryRulesStore.getState().rules.map((r) => r.title);
  });
  expect(titles).toEqual(["Пятёрочка", "Пятёрочка (копия)", "Магнит"]);
  await expect(page.locator("[data-rule-repeat]")).toHaveCount(0);

  // Повтор, пришедший с другого устройства, помечен в списке.
  await page.evaluate(async () => {
    const { useCategoryRulesStore } = await (window as unknown as StoreWindow).__store("useCategoryRulesStore");
    const list = useCategoryRulesStore.getState().rules;
    await useCategoryRulesStore.getState().replaceAll([...list, { ...list[2], id: "twin", title: "Магнит 2" }]);
  });
  await expect(page.locator("[data-rule-repeat]")).toHaveCount(1);
  await expect(rows.nth(3).locator("[data-rule-repeat]")).toBeVisible();
});
