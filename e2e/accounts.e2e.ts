/**
 * Аккаунты: окно «Фото аккаунта» — загрузка, выбор кадра, удаление; круглый
 * аватар в шапке и в её списке.
 */
import type { Page } from "@playwright/test";
import { test, expect, connectZen } from "./harness";

/** Фото 600×300: левая половина красная, правая синяя — по кадру видно, что выбрали. */
async function dropTwoColorPhoto(page: Page) {
  await page.getByRole("dialog").locator('input[type="file"]').evaluate(async (input: HTMLInputElement) => {
    const c = document.createElement("canvas");
    c.width = 600;
    c.height = 300;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 300, 300);
    ctx.fillStyle = "#0000ff";
    ctx.fillRect(300, 0, 300, 300);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "two.png", { type: "image/png" }));
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/** Цвет сохранённого аватара: «red», «blue» или «mixed» (кадр по центру). */
async function avatarColor(page: Page, src: string) {
  return page.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = c.height = 16;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0, 16, 16);
    const d = ctx.getImageData(0, 0, 16, 16).data;
    let r = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; b += d[i + 2]; }
    return r > b * 2 ? "red" : b > r * 2 ? "blue" : "mixed";
  }, src);
}

test("фото аккаунта: загрузить, выбрать кадр, удалить — и аватар в шапке", async ({ page }) => {
  await connectZen(page, "/settings");
  await page.evaluate(async () => {
    const m = await import(/* @vite-ignore */ "/src/lib/profiles.ts" as string);
    m.addProfile("Работа");
  });
  const switcher = page.locator('button[aria-label^="Аккаунт:"]');
  await expect(switcher.locator("img")).toHaveCount(0);

  // Окно открывается по кружку аккаунта.
  await page.getByRole("button", { name: /^Поставить фото «Основной»/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Фото аккаунта")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Сохранить" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Удалить фото" })).toHaveCount(0);

  await dropTwoColorPhoto(page);
  const frame = dialog.getByRole("img", { name: /^Кадр/ });
  await expect(frame).toBeVisible();
  // По умолчанию кадр по центру; утаскиваем фото влево до упора — в круге правая, синяя половина.
  const box = (await frame.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 400, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await dialog.getByRole("button", { name: "Сохранить" }).click();
  await expect(dialog).toHaveCount(0);

  const img = switcher.locator("img");
  await expect(img).toHaveCount(1);
  const src = (await img.getAttribute("src"))!;
  expect(src).toMatch(/^data:image\/(webp|jpeg);base64,/);
  expect(src.length).toBeLessThan(40_000);
  expect(await avatarColor(page, src)).toBe("blue");

  // В списке шапки — фото у «Основного», буквы у «Работы».
  await switcher.click();
  const menu = page.locator("div.fixed", { hasText: "Аккаунт" }).filter({ hasText: "Работа" });
  await expect(menu.getByRole("button", { name: /Основной/ }).locator("img")).toHaveCount(1);
  await expect(menu.getByRole("button", { name: /Работа/ }).locator("img")).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Удалить фото — из того же окна.
  await page.getByRole("button", { name: /^Сменить фото «Основной»/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Удалить фото" }).click();
  await expect(switcher.locator("img")).toHaveCount(0);
});

test.describe("телефон", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
  test("окно фото целиком в экране, кадр двигается пальцем", async ({ page }) => {
    await connectZen(page, "/settings");
    await page.getByRole("button", { name: /^Поставить фото «Основной»/ }).tap();
    await dropTwoColorPhoto(page);
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Сохранить" })).toBeInViewport({ ratio: 1 });
    expect(await dialog.evaluate((d) => d.scrollWidth - d.clientWidth)).toBe(0);
    await expect(dialog.getByRole("img", { name: /^Кадр/ })).toBeInViewport({ ratio: 1 });
  });
});
