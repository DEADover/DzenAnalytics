/**
 * Отправка правок в Дзен-мани — что и когда уходит в облако.
 */
import type { Page } from "@playwright/test";
import { test, expect, connectZen, setPushMode } from "./harness";

/** Поправить план «Продуктов» на октябрь в «Бюджет → Год» — как человек. */
async function editFoodPlan(page: Page, amount: string) {
  await page.goto("/budgets");
  await page.getByRole("button", { name: "Год", exact: true }).click();
  await page.getByRole("button", { name: /^Изменить план: Продукты · / }).first().click();
  await page.getByLabel(/^План на октябрь/).fill(amount);
  await page.getByRole("button", { name: /Сохранить/ }).click();
}

test.describe("правка одних только планов", () => {
  test("в «Вручную» видна в очереди и уходит по кнопке (#113)", async ({ page, zen }) => {
    await connectZen(page);
    await setPushMode(page, "manual");
    await editFoodPlan(page, "31000");

    const review = page.locator('button[title^="Просмотреть изменения перед отправкой"]');
    await expect(review).toHaveText("1");
    await review.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Бюджет", { exact: true })).toBeVisible();
    await expect(dialog.getByText(/Расходы · Октябрь 2026 · План \u2060?31\s000/)).toBeVisible();
    await page.keyboard.press("Escape");

    await page.locator('button[title="Отправить изменения в Дзен-мани"]').click();
    await page.getByRole("dialog").getByRole("button", { name: "Отправить" }).click();

    await expect.poll(() => zen.pushes.length).toBe(1);
    expect(zen.pushes[0].budget).toEqual([
      expect.objectContaining({ tag: "tag-food", date: "2026-10-01", outcome: 31_000, outcomeLock: true }),
    ]);
    await expect(page.locator('button[title="Нет изменений, ожидающих отправки"]')).toHaveText("0");
  });

  test("в «При синхронизации» уходит со следующей синхронизацией", async ({ page, zen }) => {
    await connectZen(page);
    await setPushMode(page, "on-sync");
    await editFoodPlan(page, "27500");

    await page.locator('button[title^="Синхронизация с Дзен-мани"]').click();
    await expect.poll(() => zen.pushes.length).toBe(1);
    expect(zen.pushes[0].budget?.[0]).toMatchObject({ tag: "tag-food", outcome: 27_500 });
  });

  test("в «Выключено» не уходит никуда", async ({ page, zen }) => {
    await connectZen(page);
    await editFoodPlan(page, "40000");
    await page.locator('button[title^="Синхронизация с Дзен-мани"]').click();
    await expect.poll(() => zen.pulls).toBeGreaterThan(1);
    expect(zen.pushes).toHaveLength(0);
  });
});

/** Переключатель режима отправки — одной строкой рядом с подписью и кнопкой,
 *  самая длинная подпись («При синхронизации») не обрезается и не переносится. */
for (const width of [1440, 1280]) {
  test(`переключатель режима отправки помещается в строку (${width})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await connectZen(page, "/settings?tab=source&source=api");
    const box = page.locator('[data-tour="push-mode"]');
    const seg = box.getByRole("group", { name: "Отправка правок в облако" });
    await expect(seg.getByRole("button", { name: "При синхронизации" })).toBeVisible();
    const m = await seg.evaluate((el) => {
      const bs = [...el.querySelectorAll("button")];
      const row = el.parentElement!;
      const label = row.querySelector("span")!;
      const send = row.querySelector(":scope > button")!;
      return {
        tops: bs.map((b) => Math.round(b.getBoundingClientRect().top)),
        clipped: bs.filter((b) => b.scrollWidth > b.clientWidth + 1 || b.getBoundingClientRect().height > 40).map((b) => b.textContent),
        rowTops: [label, el, send].map((n) => Math.round(n.getBoundingClientRect().top + n.getBoundingClientRect().height / 2)),
      };
    });
    expect(new Set(m.tops).size, `кнопки режима в разных строках: ${m.tops.join(", ")}`).toBe(1);
    expect(m.clipped, "подписи режима обрезаны или перенесены").toEqual([]);
    expect(new Set(m.rowTops).size, `ряд переносится: ${m.rowTops.join(", ")}`).toBe(1);
    if (process.env.E2E_SHOTS) await box.screenshot({ path: `${process.env.E2E_SHOTS}/push-mode-${width}.png` });
  });
}

/** Записать правку операции так, как это делает окно правки. */
async function setEdit(page: Page, id: string, patch: Record<string, unknown>) {
  await page.evaluate(
    async ([txId, p]) => {
      type S = {
        useEditsStore: { getState: () => { setEdit: (id: string, p: unknown) => Promise<void> } };
        useDataStore: { getState: () => { refresh: () => Promise<void> } };
      };
      const store = (window as unknown as { __store: (n: string) => Promise<S> }).__store;
      const { useEditsStore } = await store("useEditsStore");
      const { useDataStore } = await store("useDataStore");
      await useEditsStore.getState().setEdit(txId as string, p);
      await useDataStore.getState().refresh();
    },
    [id, patch] as const
  );
}

async function pendingEdits(page: Page): Promise<Record<string, Record<string, unknown>>> {
  return page.evaluate(async () => {
    type S = { useEditsStore: { getState: () => { edits: Record<string, Record<string, unknown>> } } };
    const { useEditsStore } = await (window as unknown as { __store: (n: string) => Promise<S> }).__store("useEditsStore");
    return useEditsStore.getState().edits;
  });
}

test("«Авто»: правка, сделанная пока шла отправка, не теряется и уходит следом", async ({ page, zen }) => {
  await connectZen(page, "/transactions");
  await setPushMode(page, "auto");
  zen.pushDelayMs = 1500;

  await setEdit(page, "tx-0003", { comment: "первая" });
  // Запрос ушёл и ждёт ответа — самое время поправить ту же операцию ещё раз.
  await expect.poll(() => zen.pushStarts, { timeout: 10_000 }).toBe(1);
  await setEdit(page, "tx-0003", { comment: "вторая" });

  // Первая отправка завершилась: в облаке «первая», а «вторая» всё ещё в очереди.
  await expect.poll(() => zen.pushes.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
  expect(zen.pushes[0].transaction?.find((t) => t.id === "tx-0003")?.comment).toBe("первая");

  // И уходит сама, второй отправкой.
  await expect.poll(() => zen.pushes.length, { timeout: 15_000 }).toBe(2);
  expect(zen.pushes[1].transaction?.find((t) => t.id === "tx-0003")?.comment).toBe("вторая");
  await expect.poll(async () => Object.keys(await pendingEdits(page)).length).toBe(0);
  // В ленте — то, что человек ввёл последним, а не откат к «первой».
  const shown = () =>
    page.evaluate(async () => {
      type S = { useDataStore: { getState: () => { transactions: { id: string; comment?: string | null }[] } } };
      const { useDataStore } = await (window as unknown as { __store: (n: string) => Promise<S> }).__store("useDataStore");
      return useDataStore.getState().transactions.find((t) => t.id === "tx-0003")?.comment;
    });
  await expect.poll(shown).toBe("вторая");
});

test("отправка, запущенная во время синхронизации, ждёт её конца — правка не пропадает с экрана", async ({ page, zen }) => {
  await connectZen(page, "/transactions");
  await setPushMode(page, "manual");
  const pullsBefore = zen.pullStarts;
  zen.pullDelays = [2000];

  // Синхронизация ушла и ждёт ответа облака…
  await page.locator('button[title^="Синхронизация с Дзен-мани"]').click();
  await expect.poll(() => zen.pullStarts).toBe(pullsBefore + 1);
  // …а человек тем временем правит операцию и отправляет.
  await setEdit(page, "tx-0003", { comment: "во время синхронизации" });
  await page.evaluate(async () => {
    type S = { useZenmoneyStore: { getState: () => { pushPendingEdits: () => Promise<unknown> } } };
    const { useZenmoneyStore } = await (window as unknown as { __store: (n: string) => Promise<S> }).__store("useZenmoneyStore");
    void useZenmoneyStore.getState().pushPendingEdits().catch(() => {});
  });

  await expect.poll(() => zen.pushes.length, { timeout: 15_000 }).toBe(1);
  expect(zen.pushes[0].transaction?.find((t) => t.id === "tx-0003")?.comment).toBe("во время синхронизации");
  await expect.poll(async () => Object.keys(await pendingEdits(page)).length).toBe(0);
  // Синхронизация не затёрла кэш отправки: в ленте то, что ввёл человек.
  const shown = () =>
    page.evaluate(async () => {
      type S = { useDataStore: { getState: () => { transactions: { id: string; comment?: string | null }[] } } };
      const { useDataStore } = await (window as unknown as { __store: (n: string) => Promise<S> }).__store("useDataStore");
      return useDataStore.getState().transactions.find((t) => t.id === "tx-0003")?.comment;
    });
  await expect.poll(shown).toBe("во время синхронизации");
  await page.waitForTimeout(2500);
  expect(await shown()).toBe("во время синхронизации");
});
