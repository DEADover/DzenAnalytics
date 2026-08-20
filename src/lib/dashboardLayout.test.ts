import { describe, it, expect } from "vitest";
import {
  DEFAULT_LAYOUT,
  WIDGETS,
  isDefaultLayout,
  isWidgetId,
  moveWidget,
  normalizeLayout,
  setWidgetHidden,
  setWidgetSpan,
  shiftWidget,
  widgetMeta,
  type WidgetPlacement,
} from "./dashboardLayout";

const ids = (layout: readonly WidgetPlacement[]) => layout.map((p) => p.id);

describe("normalizeLayout", () => {
  it("из пустоты собирает стандартную раскладку", () => {
    expect(normalizeLayout(undefined)).toEqual(DEFAULT_LAYOUT);
    expect(normalizeLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(normalizeLayout("что-то не то")).toEqual(DEFAULT_LAYOUT);
    expect(normalizeLayout([])).toEqual(DEFAULT_LAYOUT);
  });

  it("выбрасывает мусор и виджеты, которых больше нет", () => {
    const out = normalizeLayout([
      { id: "accounts", span: 1 },
      { id: "виджет-из-будущего", span: 2 },
      null,
      42,
      { span: 3 },
    ]);
    expect(out).toHaveLength(WIDGETS.length);
    expect(ids(out)).toContain("accounts");
    expect(ids(out)).not.toContain("виджет-из-будущего");
  });

  it("схлопывает повторы", () => {
    const out = normalizeLayout([
      { id: "accounts", span: 2 },
      { id: "accounts", span: 1 },
    ]);
    expect(ids(out).filter((id) => id === "accounts")).toHaveLength(1);
    // Побеждает первая запись, а не последняя.
    expect(out.find((p) => p.id === "accounts")!.span).toBe(2);
  });

  it("зажимает ширину разрешённой", () => {
    // «Быстрые переходы» живут только во всю строку.
    const out = normalizeLayout([{ id: "quicklinks", span: 1 }]);
    expect(out.find((p) => p.id === "quicklinks")!.span).toBe(3);
    // Ерунда вместо числа — ширина по умолчанию.
    const junk = normalizeLayout([{ id: "cashflow", span: "широкий" }]);
    expect(junk.find((p) => p.id === "cashflow")!.span).toBe(widgetMeta("cashflow").defaultSpan);
  });

  it("помнит убранные виджеты", () => {
    const out = normalizeLayout([{ id: "observations", span: 1, hidden: true }]);
    expect(out.find((p) => p.id === "observations")!.hidden).toBe(true);
    // Остальные — на месте и видимые.
    expect(out.filter((p) => p.hidden)).toHaveLength(1);
  });

  it("новый виджет встаёт к своим соседям, а не в конец", () => {
    // Как если бы «Расходы по категориям» появились в новой версии: в
    // сохранённой раскладке их нет.
    const saved = DEFAULT_LAYOUT.filter((p) => p.id !== "categories");
    const out = normalizeLayout(saved);
    expect(ids(out)).toEqual(ids(DEFAULT_LAYOUT));
  });

  it("держится порядка человека, дополняя его по стандартному", () => {
    const out = normalizeLayout([
      { id: "observations", span: 1 },
      { id: "month", span: 1 },
    ]);
    expect(ids(out)).toEqual([
      "observations",
      "month",
      "accounts",
      "upcoming",
      "quicklinks",
      "cashflow",
      "categories",
      "activity",
    ]);
  });
});

describe("moveWidget", () => {
  it("переносит вперёд", () => {
    const out = moveWidget(DEFAULT_LAYOUT, "month", "upcoming");
    expect(ids(out).slice(0, 3)).toEqual(["accounts", "upcoming", "month"]);
  });

  it("переносит назад", () => {
    const out = moveWidget(DEFAULT_LAYOUT, "observations", "month");
    expect(ids(out)[0]).toBe("observations");
    expect(out).toHaveLength(DEFAULT_LAYOUT.length);
  });

  it("на своё же место — ничего не меняет", () => {
    expect(ids(moveWidget(DEFAULT_LAYOUT, "month", "month"))).toEqual(ids(DEFAULT_LAYOUT));
  });
});

describe("shiftWidget", () => {
  it("меняет местами с соседом", () => {
    const out = shiftWidget(DEFAULT_LAYOUT, "accounts", -1);
    expect(ids(out).slice(0, 2)).toEqual(["accounts", "month"]);
  });

  it("на краю стоит на месте", () => {
    expect(ids(shiftWidget(DEFAULT_LAYOUT, "month", -1))).toEqual(ids(DEFAULT_LAYOUT));
    expect(ids(shiftWidget(DEFAULT_LAYOUT, "observations", 1))).toEqual(ids(DEFAULT_LAYOUT));
  });

  it("перешагивает убранные: шаг не должен уходить в пустоту", () => {
    const layout = setWidgetHidden(DEFAULT_LAYOUT, "accounts", true);
    const out = shiftWidget(layout, "month", 1);
    // «Итоги месяца» встали туда, где на экране стояли «Платежи», а убранные
    // «Балансы» так и лежат между ними.
    expect(ids(out)).toEqual([
      "upcoming",
      "accounts",
      "month",
      "quicklinks",
      "cashflow",
      "categories",
      "activity",
      "observations",
    ]);
  });
});

describe("ширина и видимость", () => {
  it("ставит разрешённую ширину", () => {
    const out = setWidgetSpan(DEFAULT_LAYOUT, "categories", 2);
    expect(out.find((p) => p.id === "categories")!.span).toBe(2);
  });

  it("не даёт сузить виджет, который живёт только во всю строку", () => {
    const out = setWidgetSpan(DEFAULT_LAYOUT, "quicklinks", 1);
    expect(out.find((p) => p.id === "quicklinks")!.span).toBe(3);
  });

  it("убирает и возвращает на то же место", () => {
    const hidden = setWidgetHidden(DEFAULT_LAYOUT, "cashflow", true);
    expect(hidden.find((p) => p.id === "cashflow")!.hidden).toBe(true);
    expect(ids(hidden)).toEqual(ids(DEFAULT_LAYOUT));

    const back = setWidgetHidden(hidden, "cashflow", false);
    expect(back.find((p) => p.id === "cashflow")!.hidden).toBeUndefined();
    expect(back).toEqual(DEFAULT_LAYOUT);
  });
});

describe("isDefaultLayout", () => {
  it("узнаёт стандартную раскладку", () => {
    expect(isDefaultLayout(DEFAULT_LAYOUT)).toBe(true);
    expect(isDefaultLayout(normalizeLayout([]))).toBe(true);
  });

  it("видит любое отличие", () => {
    expect(isDefaultLayout(setWidgetSpan(DEFAULT_LAYOUT, "categories", 2))).toBe(false);
    expect(isDefaultLayout(setWidgetHidden(DEFAULT_LAYOUT, "categories", true))).toBe(false);
    expect(isDefaultLayout(moveWidget(DEFAULT_LAYOUT, "month", "accounts"))).toBe(false);
    expect(isDefaultLayout(DEFAULT_LAYOUT.slice(1))).toBe(false);
  });
});

describe("isWidgetId", () => {
  it("отличает наш виджет от всего остального", () => {
    expect(isWidgetId("cashflow")).toBe(true);
    // На плитку можно уронить файл, ссылку или просто выделенный текст.
    expect(isWidgetId("https://example.com")).toBe(false);
    expect(isWidgetId("")).toBe(false);
  });
});

describe("реестр виджетов", () => {
  it("у каждого виджета ширина по умолчанию — из разрешённых", () => {
    for (const w of WIDGETS) {
      expect(w.spans.length).toBeGreaterThan(0);
      expect(w.spans).toContain(w.defaultSpan);
      expect(w.title.length).toBeGreaterThan(0);
      expect(w.hint.length).toBeGreaterThan(0);
    }
  });

  it("идентификаторы не повторяются", () => {
    expect(new Set(WIDGETS.map((w) => w.id)).size).toBe(WIDGETS.length);
  });
});
