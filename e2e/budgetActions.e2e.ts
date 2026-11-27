/**
 * Действие бюджета — одна кнопка-значок рядом с настройками: в «Месяце» —
 * «Заполнить план», в «Годе» и на «Дашборде» — годовой отчёт файлом. Место
 * постоянное: при переключении видов ничего в шапке не сдвигается.
 */
import { test, expect, connectZen, setPushMode } from "./harness";

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

test("годовой бюджет показывает месячные и годовые итоги с выбранной точностью (#145)", async ({ page, zen }) => {
  zen.patchFull = (diff) => {
    const [expensePlan] = diff.budget ?? [];
    const expense = diff.transaction.find((t) => t.tag?.[0] === "tag-food" && t.outcome > 0 && t.income === 0)!;
    const income = diff.transaction.find((t) => t.tag?.[0] === "tag-salary" && t.income > 0 && t.outcome === 0)!;
    return {
      ...diff,
      budget: [
        { ...expensePlan, date: "2026-09-01", outcome: 200.12 },
        { ...expensePlan, date: "2026-10-01", outcome: 1200.45 },
        { ...expensePlan, date: "2026-09-01", tag: "tag-salary", income: 500.31, incomeLock: true, outcome: 0 },
        { ...expensePlan, date: "2026-10-01", tag: "tag-salary", income: 2300.75, incomeLock: true, outcome: 0 },
      ],
      transaction: [
        { ...expense, id: "sep-expense", date: "2026-09-10", outcome: 100.20 },
        { ...expense, id: "oct-expense", date: "2026-10-10", outcome: 1140.70 },
        { ...income, id: "sep-income", date: "2026-09-10", income: 450.45 },
        { ...income, id: "oct-income", date: "2026-10-10", income: 2460.35 },
      ],
      reminder: [],
      reminderMarker: [],
    };
  };
  await connectZen(page, "/budgets");
  await page.getByRole("button", { name: "Год", exact: true }).click();
  const totals = async (name: string) => {
    const heading = page.getByRole("rowheader", { name, exact: true });
    await expect(heading).toBeVisible();
    const values = (await heading.locator("..").locator("td").allTextContents())
      .map((value) => value.replace(/\s/g, ""));
    // Первые три ячейки — «За год», затем по три ячейки на каждый месяц.
    return { year: values.slice(0, 3), october: values.slice(30, 33) };
  };
  expect(await totals("Итого расходы")).toEqual({
    year: ["1401", "1241", "160"], october: ["1200", "1141", "59"],
  });
  expect(await totals("Итого доходы")).toEqual({
    year: ["2801", "2911", "110"], october: ["2301", "2460", "159"],
  });
  expect(await totals("Доходы − расходы")).toEqual({
    year: ["1400", "1670", "270"], october: ["1100", "1320", "220"],
  });

  await page.evaluate(async () => {
    type DisplayStore = { useDisplayStore: { getState: () => { setFractionDigits: (value: number) => Promise<void> } } };
    const store = (window as unknown as { __store: (name: string) => Promise<DisplayStore> }).__store;
    await (await store("useDisplayStore")).useDisplayStore.getState().setFractionDigits(2);
  });
  await expect.poll(() => totals("Итого расходы")).toEqual({
    year: ["1400,57", "1240,90", "159,67"], october: ["1200,45", "1140,70", "59,75"],
  });
  expect(await totals("Итого доходы")).toEqual({
    year: ["2801,06", "2910,80", "109,74"], october: ["2300,75", "2460,35", "159,60"],
  });
  expect(await totals("Доходы − расходы")).toEqual({
    year: ["1400,49", "1669,90", "269,41"], october: ["1100,30", "1319,65", "219,35"],
  });
});

test("из декабря можно скопировать весь план в несколько месяцев следующего года (#146)", async ({ page, zen }) => {
  zen.patchFull = (diff) => {
    const [expensePlan] = diff.budget ?? [];
    return {
      ...diff,
      budget: [
        ...(diff.budget ?? []),
        { ...expensePlan, date: "2026-12-01", outcome: 12_345.67 },
        { ...expensePlan, date: "2027-01-01", outcome: 2_000 },
        { ...expensePlan, date: "2027-01-01", tag: "tag-cafe", outcome: 3_000 },
      ],
    };
  };
  await connectZen(page, "/budgets");
  await setPushMode(page, "manual");
  await page.getByRole("button", { name: "Год", exact: true }).click();
  // Клик принимает закреплённый двойник шапки, скрытый от скринридера.
  await page.getByRole("button", { name: /^Копировать план месяца: Декабрь/, includeHidden: true })
    .first().click({ timeout: 10_000 });
  const january = page.getByRole("button", { name: "Январь 2027", exact: true });
  const december = page.getByRole("button", { name: "Декабрь 2027", exact: true });
  const copy = page.getByRole("button", { name: "Копировать", exact: true });
  await expect(january).toHaveAttribute("aria-pressed", "false");
  await expect(copy).toBeDisabled();
  await january.click();
  await december.click();
  await copy.click();

  await page.getByRole("button", { name: "Следующий год", exact: true }).click();
  const emptyRows = page.getByRole("button", { name: /Без операций за год/, expanded: false });
  await emptyRows.click();
  const plan = page.getByRole("button", { name: /^Изменить план: Продукты · Янв/ });
  await plan.click({ timeout: 10_000 });
  await expect(page.getByLabel(/^План на январь/)).toHaveValue("12345,67");
  await page.keyboard.press("Escape");

  await page.locator('button[title="Отправить изменения в Дзен-мани"]').click();
  await page.getByRole("dialog").getByRole("button", { name: "Отправить", exact: true }).click();
  await expect.poll(() => zen.pushes.length).toBe(1);
  expect(zen.pushes[0].budget).toHaveLength(3);
  expect(zen.pushes[0].budget).toEqual(expect.arrayContaining([
    expect.objectContaining({ tag: "tag-food", date: "2027-01-01", outcome: 12_345.67 }),
    expect.objectContaining({ tag: "tag-cafe", date: "2027-01-01", outcome: 0 }),
    expect.objectContaining({ tag: "tag-food", date: "2027-12-01", outcome: 12_345.67 }),
  ]));
});

test("план одной декабрьской статьи копируется в выбранные месяцы следующего года (#146)", async ({ page, zen }) => {
  zen.patchFull = (diff) => {
    const [expensePlan] = diff.budget ?? [];
    return {
      ...diff,
      budget: [...(diff.budget ?? []), { ...expensePlan, date: "2026-12-01", outcome: 12_345.67 }],
    };
  };
  await page.setViewportSize({ width: 1280, height: 570 });
  await connectZen(page, "/budgets");
  await setPushMode(page, "manual");
  await page.getByRole("button", { name: "Год", exact: true }).click();
  await page.getByRole("button", { name: /^Изменить план: Продукты · Дек/ }).click();
  await page.getByRole("button", { name: "Копировать на другие месяцы", exact: true }).click();
  const nextYear = page.getByRole("group", { name: "2027", exact: true });
  await expect(nextYear.getByRole("button")).toHaveCount(12);
  await nextYear.getByRole("button", { name: "Февраль 2027", exact: true }).click();
  await nextYear.getByRole("button", { name: "Ноябрь 2027", exact: true }).click();
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();

  await page.locator('button[title="Отправить изменения в Дзен-мани"]').click();
  await page.getByRole("dialog").getByRole("button", { name: "Отправить", exact: true }).click();
  await expect.poll(() => zen.pushes.length).toBe(1);
  expect(zen.pushes[0].budget).toHaveLength(2);
  expect(zen.pushes[0].budget).toEqual(expect.arrayContaining([
    expect.objectContaining({ tag: "tag-food", date: "2027-02-01", outcome: 12_345.67 }),
    expect.objectContaining({ tag: "tag-food", date: "2027-11-01", outcome: 12_345.67 }),
  ]));
});
