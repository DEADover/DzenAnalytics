import { test, expect, connectZen } from "./harness";
import type { Locator, Page } from "@playwright/test";

const accent = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--c-accent").trim());

/** Кнопки в один ряд, подписи целиком. */
async function inOneRow(scope: Locator, names: RegExp) {
  const boxes = await scope.locator("button").evaluateAll(
    (bs, src) =>
      bs
        .filter((b) => new RegExp(src).test(b.textContent ?? ""))
        .map((b) => ({ top: Math.round(b.getBoundingClientRect().top), cut: b.scrollWidth > b.clientWidth + 1 })),
    names.source
  );
  expect(boxes.length).toBe(2);
  expect(new Set(boxes.map((b) => b.top)).size, "кнопки подвала в разных строках").toBe(1);
  expect(boxes.some((b) => b.cut), "подпись кнопки обрезана").toBe(false);
}

test("своя светлая тема: копия, правка акцента, живой просмотр и сохранение", async ({ page }) => {
  await connectZen(page, "/settings?tab=interface");
  await page.getByRole("button", { name: "Выбрать тему" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Тема оформления")).toBeVisible();

  const before = await accent(page);
  await dialog.getByRole("button", { name: /^Своя\s*Копия «Иней»/ }).click();
  await expect(dialog.getByText("Своя светлая тема")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-scheme", "custom-light");
  // Копия — те же цвета, что у «Инея».
  expect(await accent(page)).toBe(before);

  // Все тринадцать цветов с подписями, поля одной высоты, подписи не режутся.
  const rows = dialog.locator("[data-color-row]");
  await expect(rows).toHaveCount(13);
  const sizes = await rows.evaluateAll((els) =>
    els.map((el) => {
      const [color, hex] = [...el.querySelectorAll("input")].map((i) => Math.round(i.getBoundingClientRect().height));
      const label = el.firstElementChild as HTMLElement;
      return { color, hex, cut: label.scrollWidth > label.clientWidth + 1 };
    })
  );
  for (const s of sizes) {
    expect(s.color).toBe(38);
    expect(s.hex).toBe(38);
    expect(s.cut).toBe(false);
  }

  const reset = dialog.getByRole("button", { name: "Сбросить к теме «Иней»" });
  await expect(reset).toBeDisabled();
  await inOneRow(dialog, /Сбросить к теме|^Готово$/);

  // Акцент кодом — весь экран перекрашивается сразу.
  const hex = dialog.getByLabel("Акцент, код цвета", { exact: true });
  await hex.fill("#B0004A");
  await expect.poll(() => accent(page)).toBe("176 0 74");
  await expect(reset).toBeEnabled();

  // Белый текст на светлом акценте — предупреждение строкой рядом.
  await hex.fill("#ffe0ec");
  await expect(dialog.getByText(/Контраст с акцентом .* — мало, нужно от 4,5:1/)).toBeVisible();
  await hex.fill("#b0004a");
  await expect(dialog.getByText(/— мало/)).toHaveCount(0);
  await expect(dialog.getByText(/Контраст с акцентом 7,\d:1/)).toBeVisible();
  await expect.poll(() => accent(page)).toBe("176 0 74");

  if (process.env.E2E_SHOTS) await dialog.screenshot({ path: process.env.E2E_SHOTS + "/custom-theme.png" });

  await dialog.getByRole("button", { name: "Готово" }).click();
  await expect(dialog.getByText("Тема оформления")).toBeVisible();
  await expect(dialog.getByRole("radio", { name: /^Своя/ })).toHaveAttribute("aria-checked", "true");
  if (process.env.E2E_SHOTS) await dialog.screenshot({ path: process.env.E2E_SHOTS + "/custom-theme-list.png" });

  // После перезагрузки — те же цвета.
  await page.reload();
  await page.getByRole("banner").waitFor();
  await expect(page.locator("html")).toHaveAttribute("data-scheme", "custom-light");
  expect(await accent(page)).toBe("176 0 74");

  // «Сбросить к теме» возвращает цвета «Инея».
  await page.getByRole("button", { name: "Выбрать тему" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Настроить свои цвета" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Сбросить к теме «Иней»" }).click();
  await expect.poll(() => accent(page)).toBe(before);
});

test("палитра команд открывает редактор своих цветов", async ({ page }) => {
  await connectZen(page, "/");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder(/^Команда \/ страница/).fill("свои цвета");
  await page.getByText("Настроить свои цвета").first().click();
  await expect(page.getByRole("dialog").getByText("Своя светлая тема")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-scheme", "custom-light");
});
