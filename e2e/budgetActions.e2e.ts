/**
 * Действие бюджета — одна кнопка-значок рядом с настройками: в «Месяце» —
 * «Заполнить план», в «Годе» и на «Дашборде» — годовой отчёт файлом. Место
 * постоянное: при переключении видов ничего в шапке не сдвигается.
 */
import { test, expect, connectZen } from "./harness";

test("кнопка рядом с настройками: «Заполнить план» в месяце, отчёт в году и на дашборде, без сдвигов", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await connectZen(page, "/budgets");
  const settings = page.getByRole("button", { name: "Настройки бюджета" });
  const xOf = async () => (await settings.boundingBox())!.x;
  const segX = async () =>
    (await page.getByRole("button", { name: "Дашборд", exact: true }).first().boundingBox())!.x;

  await page.getByRole("button", { name: "Месяц", exact: true }).first().click();
  const fill = page.getByRole("button", { name: "Заполнить план" });
  await expect(fill).toHaveCount(1);
  const monthX = await xOf();
  const monthSeg = await segX();
  await fill.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // Поступления первыми — как и на странице.
  const text = await dialog.innerText();
  expect(text.search(/Поступления/i)).toBeGreaterThanOrEqual(0);
  expect(text.search(/Расходы/i)).toBeGreaterThan(text.search(/Поступления/i));
  await page.keyboard.press("Escape");

  for (const view of ["Год", "Дашборд"]) {
    await page.getByRole("button", { name: view, exact: true }).first().click();
    await expect(page.getByRole("button", { name: "Заполнить план" })).toHaveCount(0);
    const report = page.getByRole("button", { name: "Скачать годовой отчёт" });
    await expect(report).toHaveCount(1);
    expect(await xOf()).toBe(monthX);
    expect(await segX()).toBe(monthSeg);
    await report.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
  }
});
