/**
 * #144: «#» в полях поиска и фильтра открывает список хэштегов из комментариев
 * — тот же, что в окне операции.
 */
import type { ZenDiffResponse } from "../src/lib/zenmoney";
import { test, expect, connectZen } from "./harness";

const withTags = (diff: ZenDiffResponse) => {
  let n = 0;
  return {
    ...diff,
    transaction: (diff.transaction ?? []).map((t) =>
      t.payee === "Пятёрочка" && t.date.startsWith("2026-10") && n++ < 3
        ? { ...t, comment: "Покупка #отпуск" }
        : t.payee === "Кинопоиск"
          ? { ...t, comment: "#отдых вечером" }
          : t
    ),
  };
};

test("общий фильтр: «#» показывает теги, Enter подставляет", async ({ page, zen }) => {
  zen.patchFull = withTags as never;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connectZen(page, "/categories");
  const field = page.getByRole("textbox", { name: "Фильтр: получатель, комментарий" });
  await field.click();
  await field.pressSequentially("#");
  const menu = page.locator("[data-hashtag-menu]");
  await expect(menu.getByRole("button")).toHaveText(["отдых", "отпуск"]);
  await field.pressSequentially("отп");
  await expect(menu.getByRole("button")).toHaveText(["отпуск"]);
  await field.press("Enter");
  await expect(field).toHaveValue("#отпуск ");
  await expect(menu).toHaveCount(0);

  // Esc закрывает список, и отпущенная клавиша его не открывает снова.
  await field.fill("");
  await field.pressSequentially("#");
  await expect(menu).toBeVisible();
  await field.press("Escape");
  await expect(menu).toHaveCount(0);
});

test("быстрый поиск в «Операциях»: вместо выбора «где искать» — теги", async ({ page, zen }) => {
  zen.patchFull = withTags as never;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connectZen(page, "/transactions");
  const field = page.locator("[data-search-scope-field] input");
  await field.click();
  await field.pressSequentially("#от");
  const menu = page.locator("[data-hashtag-menu]");
  await expect(menu).toBeVisible();
  await expect(page.locator("#search-scope-list")).toHaveCount(0);
  await menu.getByRole("button", { name: "отпуск" }).click();
  await expect(field).toHaveValue("#отпуск ");
  await expect(page.locator(".op-row", { hasText: "Покупка #отпуск" })).toHaveCount(3);
});

test("окно операции: подсказка в комментарии работает как раньше", async ({ page, zen }) => {
  zen.patchFull = withTags as never;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connectZen(page, "/transactions");
  await page.locator(".op-row").first().locator('button[aria-label="Изменить операцию"]').click();
  const dialog = page.getByRole("dialog");
  const comment = dialog.locator("textarea").first();
  await comment.fill("");
  await comment.pressSequentially("#отп");
  const menu = page.locator("[data-hashtag-menu]");
  await expect(menu.getByRole("button")).toHaveText(["отпуск"]);
  await comment.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await comment.pressSequentially("у");
  await expect(menu).toBeVisible();
  await comment.press("Enter");
  await expect(comment).toHaveValue("#отпуск ");
});
