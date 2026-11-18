/**
 * Виджеты главной «Темп трат» и «Разобрать», и подсказка дня в «Календаре»
 * при выключенных «Всплывающих подсказках».
 */
import { test, expect, connectZen } from "./harness";
import type { Page } from "@playwright/test";

type Store = { getState: () => Record<string, (...a: unknown[]) => Promise<void>> };
type Win = { __store: (n: string) => Promise<Record<string, Store>> };

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

const tile = (page: Page, name: string) => page.locator(`[data-tour="widget-${name}"]`);

/** Поставить снятый по умолчанию виджет на главную. */
async function place(page: Page, key: string, view?: string) {
  await page.evaluate(
    async ([k, v]) => {
      const w = window as unknown as Win;
      const { useDashboardLayoutStore } = await w.__store("useDashboardLayoutStore");
      await useDashboardLayoutStore.getState().setHidden(k, false);
      if (v) await useDashboardLayoutStore.getState().setView(k, v);
    },
    [key, view ?? ""] as const
  );
}

test("«Темп трат»: число, сравнение с прошлым месяцем и статьи", async ({ page }) => {
  await connectZen(page, "/");
  await place(page, "pace");
  const pace = tile(page, "pace");
  await expect(pace).toBeVisible();
  await expect(pace).toContainText("Потрачено к 15 октября");
  await expect(pace).toContainText("В сентябре к этому дню");
  await expect(pace.getByTestId("pace-total")).toContainText("₽");
  await expect(pace.locator(".recharts-line")).toHaveCount(2);

  // Статьи сходятся с числом в шапке: строки — это оно же, разложенное.
  const rows = pace.getByTestId("pace-categories");
  await expect(rows).toContainText("Дом");
  await expect(rows).toContainText("Продукты");

  // Клик по статье открывает её операции за месяц.
  await rows.getByRole("button", { name: /Дом/ }).click();
  await expect(page.locator("[data-exit-panel]")).toContainText("Дом · Октябрь");
  await page.keyboard.press("Escape");

  // «График»: три линии и легенда со средним.
  await place(page, "pace", "chart");
  await expect(pace.locator(".recharts-line")).toHaveCount(3);
  await expect(pace).toContainText("Среднее за 3 месяца");
  await expect(pace.getByTestId("pace-categories")).toHaveCount(0);
});

test("«Разобрать»: счётчики и переход к самим операциям", async ({ page }) => {
  await connectZen(page, "/");
  await place(page, "triage");
  const triage = tile(page, "triage");
  await expect(triage).toBeVisible();

  // В поддельном аккаунте две непросмотренные операции.
  const unseen = triage.locator('[data-triage="unseen"]');
  await expect(unseen).toHaveAttribute("data-count", "2");
  // Без категории нет — строка на месте, с галочкой и без клика.
  const uncat = triage.locator('[data-triage="uncategorized"]');
  await expect(uncat).toHaveAttribute("data-count", "0");
  await expect(uncat.getByLabel("Ничего не осталось")).toBeVisible();
  await expect(triage.locator('[data-triage="unsent"]')).toHaveAttribute("data-count", "0");

  await unseen.click();
  const drawer = page.locator("[data-exit-panel]");
  await expect(drawer).toContainText("Новые операции");
  await expect(drawer).toContainText("Перекрёсток");
  await expect(drawer).toContainText("Кофейня у дома");
});

test("«Календарь»: сумма дня показывается и при выключенных подсказках", async ({ page }) => {
  await connectZen(page, "/calendar");
  await page.evaluate(async () => {
    const w = window as unknown as Win;
    const { useDisplayStore } = await w.__store("useDisplayStore");
    await useDisplayStore.getState().setHints(false);
  });
  // 10 октября — аренда 35 000 ₽.
  const october = page.locator('[data-calendar-month="9"]');
  await october.getByRole("button", { name: "10", exact: true }).hover();
  const tip = page.getByRole("tooltip");
  await expect(tip).toContainText(/Расходы:.*35/);
  await expect(tip).toContainText(/операци/);
});

test("«Бюджет месяца»: статьи с планом и операции статьи", async ({ page }) => {
  await connectZen(page, "/");
  await place(page, "budget");
  const budget = tile(page, "budget");
  await expect(budget).toBeVisible();
  // В поддельном аккаунте план один: «Продукты», 25 000 ₽ на октябрь.
  const row = budget.locator('[data-budget-row="Продукты|"]');
  await expect(row).toContainText(/из\s*.?25\s000/);
  await expect(row).toContainText("Осталось");
  // Самая потраченная статья — первой.
  await expect(budget.locator("[data-budget-row]").first()).toContainText("Перерасход");
  await expect(budget).toContainText("План превышен у");
  await row.click();
  await expect(page.locator("[data-exit-panel]")).toContainText("Продукты · Октябрь");
});

test("«Цели»: пустое состояние и цель с прогрессом", async ({ page }) => {
  await connectZen(page, "/");
  await place(page, "goals");
  const goals = tile(page, "goals");
  await expect(goals).toContainText("Целей пока нет");
  await page.evaluate(async () => {
    const w = window as unknown as Win;
    const { useGoalsStore } = await w.__store("useGoalsStore");
    await useGoalsStore.getState().add({
      name: "Отпуск",
      target: 200_000,
      current: 50_000,
      deadline: null,
      monthlyContribution: 30_000,
    });
  });
  const row = goals.locator('[data-goal="Отпуск"]');
  await expect(row).toContainText("25%");
  // Под целью — прогноз, срок и взнос в месяц.
  await expect(row.locator("[data-goal-stats]")).toContainText("Прогноз");
  await expect(row.locator("[data-goal-stats]")).toContainText("Без срока");
  await expect(row.locator("[data-goal-stats]")).toContainText(/Отчисления\s*.?30\s000/);
  // Свод над списком: накоплено и сколько осталось.
  await expect(goals).toContainText("Накоплено");
  await expect(goals).toContainText(/Осталось\s*.?150\s000/);
  await expect(goals).toContainText("Достигнуто 0 из 1");
  await row.click();
  await expect(page).toHaveURL(/\/goals$/);
});

test("«Категория под наблюдением»: заводится из списка, статья выбирается в виджете", async ({ page }) => {
  await connectZen(page, "/");
  await page.evaluate(async () => {
    const w = window as unknown as Win;
    const { useDashboardLayoutStore } = await w.__store("useDashboardLayoutStore");
    const s = useDashboardLayoutStore.getState() as unknown as {
      add: (kind: string) => Promise<void>;
    };
    await s.add("watch");
    await s.add("watch");
  });
  const first = page.locator('[data-widget-key="watch"]');
  const second = page.locator('[data-widget-key="watch-2"]');
  await expect(first).toContainText("За какой категорией следить");
  await expect(second).toBeVisible();

  await first.getByTestId("watch-picker").getByText("Выберите категорию").click();
  await page.getByRole("option", { name: "Дом", exact: true }).click();
  await expect(first.getByTestId("watch-total")).toContainText(/35\s000/);
  await expect(first).toContainText("Потрачено к 15 октября");
  await expect(first).toContainText("Обычно к этому дню");
  await expect(first.getByTestId("watch-bars").getByRole("button")).toHaveCount(6);
  // Второй виджет своей статьи пока не знает.
  await expect(second).toContainText("За какой категорией следить");

  // Выбор пережил перезагрузку.
  await page.reload();
  await expect(first.getByTestId("watch-total")).toContainText(/35\s000/);

  // Столбик открывает операции статьи за свой месяц.
  await first.getByTestId("watch-bars").getByRole("button").first().click();
  await expect(page.locator("[data-exit-panel]")).toContainText("Дом · Май");
});

test("«Цели»: видны ровно две цели, третья — только после прокрутки", async ({ page }) => {
  await connectZen(page, "/");
  await place(page, "goals");
  await page.evaluate(async () => {
    const w = window as unknown as Win;
    const { useGoalsStore } = await w.__store("useGoalsStore");
    for (const [name, current] of [["Первая", 90_000], ["Вторая", 50_000], ["Третья", 10_000]] as const) {
      await useGoalsStore.getState().add({
        name,
        target: 100_000,
        current,
        deadline: null,
        monthlyContribution: 5_000,
      });
    }
  });
  const goals = tile(page, "goals");
  const list = goals.locator("[data-goal-list]");
  await expect(list.locator("[data-goal]")).toHaveCount(3);

  /** Где карточка относительно окна списка: целиком внутри, целиком снаружи или обрезана. */
  const where = (name: string) =>
    list.evaluate((el, n) => {
      const box = el.getBoundingClientRect();
      const card = el.querySelector(`[data-goal="${n}"]`)!.getBoundingClientRect();
      if (card.top >= box.top - 1 && card.bottom <= box.bottom + 1) return "inside";
      if (card.top >= box.bottom - 1 || card.bottom <= box.top + 1) return "outside";
      return "cut";
    }, name);

  expect(await where("Первая")).toBe("inside");
  expect(await where("Вторая")).toBe("inside");
  expect(await where("Третья")).toBe("outside");

  // Прокрутка открывает третью целиком и останавливается на границе карточки.
  await list.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await expect.poll(() => where("Третья")).toBe("inside");
  expect(await where("Первая")).toBe("outside");
});

/** Завести виджет вида, которого на главной может быть несколько. */
async function add(page: Page, kind: string) {
  await page.evaluate(async (k) => {
    const w = window as unknown as Win;
    const { useDashboardLayoutStore } = await w.__store("useDashboardLayoutStore");
    await (useDashboardLayoutStore.getState() as unknown as { add: (kind: string) => Promise<void> }).add(k);
  }, kind);
}

test("«Категория под наблюдением»: доходная категория и категория целиком", async ({ page }) => {
  await connectZen(page, "/");
  await add(page, "watch");
  await add(page, "watch");
  const income = page.locator('[data-widget-key="watch"]');
  const group = page.locator('[data-widget-key="watch-2"]');

  // Доходная: переключатель над полем меняет список категорий.
  await income.getByTestId("watch-picker").getByRole("button", { name: "Доходы" }).click();
  await income.getByTestId("watch-picker").getByText("Выберите категорию").click();
  await page.getByRole("option", { name: "Зарплата", exact: true }).click();
  await expect(income.getByTestId("watch-widget")).toHaveAttribute("data-watch-kind", "income");
  await expect(income).toContainText("Получено к 15 октября");
  await expect(income.getByTestId("watch-total")).toContainText(/150\s000/);
  await income.getByTestId("watch-total").click();
  await expect(page.locator("[data-exit-panel]")).toContainText("Доходы по категории");
  await page.keyboard.press("Escape");

  // Категория с подкатегорией — целиком: пункт называется «Вся категория», и
  // в число входят траты подкатегории «Такси».
  await group.getByTestId("watch-picker").getByText("Выберите категорию").click();
  await page.getByRole("option", { name: "Транспорт", exact: true }).click();
  await page.getByRole("option", { name: "Вся категория", exact: true }).click();
  await expect(group).toContainText("Транспорт");
  await expect(group.getByTestId("watch-total")).toContainText(/455/);

  // Кнопка в шапке ведёт в «Категории» той же стороной, что считает виджет.
  await expect(income.getByRole("link", { name: "Категории" })).toHaveAttribute("href", "/categories?kind=income");
  await expect(group.getByRole("link", { name: "Категории" })).toHaveAttribute("href", "/categories?kind=expense");

  // Выбор пережил перезагрузку — вместе с тем, что категория доходная.
  await page.reload();
  await expect(income.getByTestId("watch-widget")).toHaveAttribute("data-watch-kind", "income");
  await expect(group.getByTestId("watch-total")).toContainText(/455/);
});

test("«Тег под наблюдением»: расходы и доходы одного тега", async ({ page }) => {
  await connectZen(page, "/");
  // Один хэштег на расходе и на доходе октября.
  await page.evaluate(async () => {
    type Tx = { id: string; date: string; kind: string };
    const w = window as unknown as {
      __store: (n: string) => Promise<Record<string, { getState: () => Record<string, unknown> }>>;
    };
    const { useDataStore } = await w.__store("useDataStore");
    const data = useDataStore.getState() as { transactions: Tx[]; refresh: () => Promise<void> };
    const rent = data.transactions.find((t) => t.date === "2026-10-10" && t.kind === "expense")!;
    const salary = data.transactions.find((t) => t.date === "2026-10-05" && t.kind === "income")!;
    const { useEditsStore } = await w.__store("useEditsStore");
    const edits = useEditsStore.getState() as {
      setEdit: (id: string, patch: { comment: string }) => Promise<void>;
    };
    await edits.setEdit(rent.id, { comment: "Аренда #квартира" });
    await edits.setEdit(salary.id, { comment: "Зарплата #квартира" });
    await data.refresh();
  });
  await add(page, "watchTag");
  const widget = page.locator('[data-widget-key="watchTag"]');
  await expect(widget).toContainText("Тег под наблюдением");

  await widget.getByTestId("tag-picker").getByRole("combobox").click();
  await page.getByRole("option", { name: /квартира/ }).click();

  const body = widget.getByTestId("tag-watch-widget");
  await expect(body.locator('[data-watch-head="expense"]')).toContainText(/35\s000/);
  await expect(body.locator('[data-watch-head="income"]')).toContainText(/150\s000/);
  await expect(widget).toContainText("квартира");

  // Кнопка в шапке ведёт в «Теги» — на этот тег и в его режиме.
  await expect(widget.getByRole("link", { name: "Теги" })).toHaveAttribute(
    "href",
    `/tags?mode=hashtags&tag=${encodeURIComponent("квартира")}`
  );

  // Клик по стороне открывает её операции за месяц.
  await body.locator('[data-watch-head="income"]').click();
  const drawer = page.locator("[data-exit-panel]");
  await expect(drawer).toContainText("#квартира · Октябрь");
  await expect(drawer).toContainText("Доходы по тегу");
  await page.keyboard.press("Escape");

  await page.reload();
  await expect(widget.getByTestId("tag-watch-widget").locator('[data-watch-head="expense"]')).toContainText(/35\s000/);

  // Переход: раздел на этом теге, его строка раскрыта разбивкой по категориям.
  await widget.getByRole("link", { name: "Теги" }).click();
  await expect(page).toHaveURL(/\/tags\?mode=hashtags&tag=/);
  const row = page.locator("tr.tag-focus");
  await expect(row).toContainText("квартира");
  await expect(row).toBeInViewport();
  await expect(page.locator("table").filter({ has: row }).locator("tbody tr").nth(1)).toContainText("Дом");
});

test("«Теги»: ссылка со второй категорией переключает режим раздела", async ({ page }) => {
  await connectZen(page, "/tags?mode=categories&tag=" + encodeURIComponent("Отпуск"));
  // Режим раздела подстроился под ссылку — и запомнился, как выбранный руками.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const w = window as unknown as {
          __store: (n: string) => Promise<Record<string, { getState: () => { mode: string } }>>;
        };
        const { useTagModeStore } = await w.__store("useTagModeStore");
        return useTagModeStore.getState().mode;
      })
    )
    .toBe("categories");
});
