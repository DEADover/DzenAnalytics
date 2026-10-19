/**
 * Поле даты в окне операции набирается по маске «дд.мм.гггг» (#125): щелчок
 * выделяет дату целиком, цифры заменяют, а не вставляются, точки встают сами.
 */
import { test, expect, connectZen } from "./harness";

test("дата по маске: щелчок в середину и набор не ломают дату", async ({ page }) => {
  await connectZen(page, "/transactions");
  await page.locator(`button[title="Добавить новую операцию"]`).first().click();
  await page.getByRole("menuitem", { name: "Расход" }).or(page.getByRole("button", { name: "Расход", exact: true })).first().click();
  const card = page.getByRole("dialog").filter({ hasText: "Новая операция" });
  const date = card.getByLabel("Дата", { exact: true }).first();
  await expect(date).toHaveValue("15.10.2026");

  // Щелчок между «15» и «.10» — как на скриншоте из задачи. Дата выделяется
  // целиком, набор начинается с нуля, точки ставит маска.
  const box = (await date.boundingBox())!;
  await page.mouse.click(box.x + 18, box.y + box.height / 2);
  await page.keyboard.type("18");
  await expect(date).toHaveValue("18.");
  await page.keyboard.type("092026");
  await expect(date).toHaveValue("18.09.2026");
  // Лишние цифры не дописываются.
  await page.keyboard.type("7");
  await expect(date).toHaveValue("18.09.2026");

  // Курсор в начало — цифры заменяют день, а не раздвигают текст.
  await page.keyboard.press("Home");
  await page.keyboard.type("21");
  await expect(date).toHaveValue("21.09.2026");

  await page.keyboard.press("Enter");
  await expect(date).toHaveValue("21.09.2026");
  await expect(date).not.toHaveAttribute("aria-invalid", "true");
});
