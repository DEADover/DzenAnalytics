/**
 * Стресс-прогон «Контрагентов»: много состояний, в каждом — общий аудит.
 */
import { test, expect, connectZen, horizontalOverflow } from "./harness";
import type { Page } from "@playwright/test";

const PRESETS = ["period", "month", "30d", "3m", "6m", "12m", "ytd", "quarter", "year", "all"] as const;

async function openDemo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Открыть демо-данные" }).click();
  await expect(page.getByText("Это демо-данные выдуманной семьи.")).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => history.pushState({}, "", "/counterparties"));
  await page.evaluate(() => dispatchEvent(new PopStateEvent("popstate")));
  await page.getByText("Все контрагенты").or(page.getByText("Нет трат с контрагентом")).first().waitFor();
}

async function setFilters(page: Page, patch: Record<string, unknown>) {
  await page.evaluate(async (p) => {
    type S = { useFiltersStore: { setState: (x: unknown) => void } };
    const { useFiltersStore } = await (window as unknown as { __store: (n: string) => Promise<S> }).__store("useFiltersStore");
    useFiltersStore.setState(p);
  }, patch);
  await page.waitForTimeout(250);
}

/** Общий аудит экрана: битые числа, прокрутка вбок, обрезанные подписи. */
async function audit(page: Page, label: string, strictCut: boolean): Promise<string[]> {
  const problems: string[] = [];
  const text = await page.locator("main").innerText();
  for (const bad of ["NaN", "undefined", "Infinity", "null", "[object"]) if (text.includes(bad)) problems.push(`${label}: в тексте «${bad}»`);
  const over = await horizontalOverflow(page);
  if (over > 0) problems.push(`${label}: прокрутка вбок ${over}px`);
  if (strictCut) {
    const cut = await page.locator("main").evaluate((main) =>
      [...main.querySelectorAll("*")]
        .filter((e) => e.children.length === 0 && !e.closest("tbody") && !e.hasAttribute("data-dossier-title") && e.scrollWidth > e.clientWidth + 1)
        .map((e) => (e.textContent ?? "").slice(0, 40))
    );
    if (cut.length) problems.push(`${label}: обрезано ${JSON.stringify(cut.slice(0, 5))}`);
  }
  return problems;
}

for (const dataset of ["fake", "demo"] as const) {
  test(`${dataset}: все периоды и ширины`, async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.setViewportSize({ width: 1440, height: 1000 });
    if (dataset === "fake") await connectZen(page, "/counterparties");
    else await openDemo(page);

    const problems: string[] = [];
    for (const preset of PRESETS) {
      await setFilters(page, { preset });
      problems.push(...(await audit(page, `1440/${preset}`, true)));
      for (const dir of ["Дешевле", "Дороже"]) {
        const b = page.getByRole("radio", { name: dir }).or(page.getByRole("button", { name: dir, exact: true })).first();
        if (await b.count()) await b.click();
      }
      problems.push(...(await audit(page, `1440/${preset}/дешевле`, true)));
    }
    await setFilters(page, { preset: "custom", from: "2026-02-03", to: "2026-05-17" });
    problems.push(...(await audit(page, `1440/custom`, true)));
    await setFilters(page, { preset: "year", search: "пят" });
    problems.push(...(await audit(page, `1440/поиск`, true)));
    await setFilters(page, { search: "zzzzzz" });
    problems.push(...(await audit(page, `1440/поиск-пусто`, true)));
    await setFilters(page, { search: "" });

    for (const width of [375, 768, 1024, 1280, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      for (const preset of ["period", "year", "all"] as const) {
        await setFilters(page, { preset });
        problems.push(...(await audit(page, `${width}/${preset}`, width >= 1024)));
      }
    }

    // Каждая строка за год: карточка без битых чисел, три показателя графиков.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await setFilters(page, { preset: "year" });
    const card = page.locator("[data-place-card]");
    const rows = await page.locator("table").first().locator("tbody tr").all();
    for (const [i, tr] of rows.entries()) {
      await tr.click();
      const t = await card.innerText();
      for (const bad of ["NaN", "undefined", "Infinity", "null"]) if (t.includes(bad)) problems.push(`строка ${i}: «${bad}» в карточке`);
      if (i % 7 === 0) {
        for (const m of ["Операции", "Чек", "Сумма"]) await card.getByRole("radio", { name: m }).or(card.getByRole("button", { name: m, exact: true })).first().click();
      }
    }
    // Клики: месяц, день недели, число операций, «Все операции».
    await card.locator(".recharts-bar-rectangle").last().click();
    await page.keyboard.press("Escape");
    const day = card.locator("button:enabled[aria-label$=': показать операции']").first();
    await day.click();
    await page.keyboard.press("Escape");
    await page.locator("table").first().locator("tbody tr").first().getByRole("button").first().click();
    await page.keyboard.press("Escape");
    await card.getByRole("button", { name: "Все операции" }).click();
    await page.keyboard.press("Escape");

    console.log(`\n=== ${dataset}: проблем ${problems.length}, ошибок консоли ${errors.length}`);
    for (const p of [...new Set(problems)]) console.log("  - " + p);
    for (const e of [...new Set(errors)].slice(0, 10)) console.log("  ! " + e.slice(0, 200));
    expect([...new Set(problems)]).toEqual([]);
    expect(errors).toEqual([]);
  });
}
