/**
 * Движение: всплывающие панели и окна появляются и уходят плавно, а подсветка
 * при наведении меняется переходом, а не рывком. Проверяем разметку, по
 * которой это движение включается, и то, что уходящая копия не мешает:
 * не ловит клики, не видна ролям и сама убирается.
 */
import { test, expect, connectZen } from "./harness";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("всплывающая панель: вырастает и уходит, уходящая не ловит кликов", async ({ page }) => {
  await connectZen(page, "/");
  const gear = page.getByRole("button", { name: "Быстрые настройки" });
  await gear.click();
  const surface = page.locator("[data-pop]");
  await expect(surface).toHaveCount(1);
  await expect(surface).toHaveAttribute("data-pop", "right");
  // Появление — 250 мс с мягким торможением; после него сдвига не остаётся.
  const anim = await surface.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { name: cs.animationName, dur: cs.animationDuration };
  });
  expect(anim).toEqual({ name: "popIn", dur: "0.25s" });
  await expect.poll(() => surface.evaluate((el) => getComputedStyle(el).transform)).toBe("none");

  await page.keyboard.press("Escape");
  // Уходит: ещё в дереве, но уже не видна ролям и не ловит кликов…
  const closing = page.locator("[data-pop][data-closing]");
  await expect(closing).toHaveCount(1);
  expect(await closing.evaluate((el) => (el as HTMLElement).inert)).toBe(true);
  await expect(page.getByRole("dialog", { name: "Быстрые настройки" })).toHaveCount(0);
  // …и через мгновение исчезает совсем.
  await expect(surface).toHaveCount(0);
});

test("окно: проявляется и уходит слепком, слепок убирается сам", async ({ page }) => {
  await connectZen(page, "/");
  await page.getByRole("button", { name: "Быстрые настройки" }).click();
  await page.getByRole("button", { name: "Настроить быстрые настройки" }).click();
  const dialog = page.locator('[role="dialog"][aria-modal="true"]');
  await expect(dialog).toHaveCount(1);
  expect(await dialog.evaluate((el) => getComputedStyle(el).animationName)).toBe("modalIn");

  await dialog.getByRole("button", { name: "Закрыть" }).click();
  // Настоящего окна уже нет — остался гаснущий слепок без id и ролей.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const ghost = page.locator(".exit-ghost");
  await expect(ghost).toHaveCount(1);
  expect(
    await ghost.evaluate((el) => ({
      hidden: el.getAttribute("aria-hidden"),
      inert: (el as HTMLElement).inert,
      ids: el.querySelectorAll("[id]").length,
    }))
  ).toEqual({ hidden: "true", inert: true, ids: 0 });
  await expect(ghost).toHaveCount(0);
});

test("наведение: подсветка из разметки меняется переходом", async ({ page }) => {
  await connectZen(page, "/transactions");
  await expect(page.locator(".op-row").first()).toBeVisible();
  const durations = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[class*="hover:bg-"]')].map(
      (el) => getComputedStyle(el).transitionDuration.split(",")[0].trim()
    )
  );
  expect(durations.length).toBeGreaterThan(10);
  expect(durations.filter((d) => d === "0s")).toEqual([]);
});

test("«уменьшить движение»: всё мгновенно, слепков нет", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await connectZen(page, "/");
  await page.getByRole("button", { name: "Быстрые настройки" }).click();
  await page.getByRole("button", { name: "Настроить быстрые настройки" }).click();
  await page.locator('[role="dialog"][aria-modal="true"]').getByRole("button", { name: "Закрыть" }).click();
  await expect(page.locator(".exit-ghost")).toHaveCount(0);
  await expect(page.locator("[data-pop]")).toHaveCount(0);
});
