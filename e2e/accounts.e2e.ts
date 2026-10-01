/**
 * Аккаунты: фото в «Настройках» → круглый аватар в шапке и в её списке.
 */
import { test, expect, connectZen } from "./harness";

test("фото аккаунта — в настройках, в шапке и в списке аккаунтов", async ({ page }) => {
  await connectZen(page, "/settings");
  // Второй аккаунт — без него переключателя в шапке нет.
  await page.evaluate(async () => {
    const m = await import(/* @vite-ignore */ "/src/lib/profiles.ts" as string);
    m.addProfile("Работа");
  });

  // Пока фото нет — буквы на цвете.
  const switcher = page.locator('button[aria-label^="Аккаунт:"]');
  await expect(switcher).toBeVisible();
  await expect(switcher.locator("img")).toHaveCount(0);

  // Фото — квадрат, нарисованный тут же, подсовываем в выбор файла.
  await page.getByRole("button", { name: /^Поставить фото «Основной»/ }).click();
  await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 400;
    c.height = 300;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#2a9d8f";
    ctx.fillRect(0, 0, 400, 300);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"));
    const input = document.querySelector('#accounts input[type="file"]') as HTMLInputElement;
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "me.png", { type: "image/png" }));
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  // В шапке — круглое фото вместо значка и имени.
  const img = switcher.locator("img");
  await expect(img).toHaveCount(1);
  const src = await img.getAttribute("src");
  expect(src).toMatch(/^data:image\/(webp|jpeg);base64,/);
  // Маленький квадрат, а не исходник.
  expect(src!.length).toBeLessThan(40_000);
  const box = await img.boundingBox();
  expect(Math.round(box!.width)).toBe(Math.round(box!.height));

  // В списке аккаунтов шапки — тоже.
  await switcher.click();
  const menu = page.locator("div.fixed", { hasText: "Аккаунт" }).filter({ hasText: "Работа" });
  await expect(menu.getByRole("button", { name: /Основной/ }).locator("img")).toHaveCount(1);
  // У «Работы» фото нет — буквы.
  await expect(menu.getByRole("button", { name: /Работа/ }).locator("img")).toHaveCount(0);
  await expect(menu.getByRole("button", { name: /Работа/ })).toContainText("Р");

  // Убрать фото — снова буквы.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Убрать фото «Основной»/ }).click();
  await expect(switcher.locator("img")).toHaveCount(0);
});
