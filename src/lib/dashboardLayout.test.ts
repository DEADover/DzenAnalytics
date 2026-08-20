import { describe, it, expect } from "vitest";
import {
  DEFAULT_LAYOUT,
  DEFAULT_LINKS,
  MAX_LINKS,
  WIDGETS,
  addLinksRow,
  isDefaultLayout,
  layoutFromStored,
  moveWidget,
  normalizeLayout,
  removeWidget,
  setRowLinks,
  setWidgetHidden,
  shiftWidget,
  type WidgetPlacement,
} from "./dashboardLayout";

const keys = (layout: readonly WidgetPlacement[]) => layout.map((p) => p.key);
const kinds = (layout: readonly WidgetPlacement[]) => layout.map((p) => p.kind);
const row = (layout: readonly WidgetPlacement[], key: string) =>
  layout.find((p) => p.key === key)!;

describe("layoutFromStored", () => {
  it("когда ничего не сохранено — стандартная раскладка целиком", () => {
    for (const raw of [undefined, null, "что-то не то", 42, {}]) {
      expect(layoutFromStored(raw)).toEqual(DEFAULT_LAYOUT);
    }
  });

  it("списки кнопок у копии свои, а не общие со стандартной", () => {
    const a = layoutFromStored(null);
    const b = layoutFromStored(null);
    expect(a.find((p) => p.key === "links")!.links).not.toBe(
      b.find((p) => p.key === "links")!.links
    );
  });

  it("раскладку из другой версии собирает заново", () => {
    // Старая запись: у мест был `id`, а не `kind`. Узнать в ней нечего.
    expect(layoutFromStored([{ id: "accounts", span: 1 }, { id: "month" }])).toEqual(
      DEFAULT_LAYOUT
    );
  });

  it("сохранённую раскладку разбирает как есть", () => {
    // Дорожку сняли руками — обратно она не возвращается.
    const saved = DEFAULT_LAYOUT.filter((p) => p.kind !== "links");
    expect(kinds(layoutFromStored(saved))).not.toContain("links");
  });
});

describe("normalizeLayout", () => {
  it("из пустого списка собирает все одиночные виджеты", () => {
    // Дорожки среди них нет: её заводят руками.
    expect(kinds(normalizeLayout([]))).toEqual(
      WIDGETS.filter((w) => !w.multi).map((w) => w.kind)
    );
  });

  it("выбрасывает мусор и виджеты, которых больше нет", () => {
    const out = normalizeLayout([
      { key: "accounts", kind: "accounts" },
      { key: "x", kind: "виджет-из-будущего" },
      null,
      42,
      { hidden: true },
    ]);
    expect(kinds(out)).toContain("accounts");
    expect(kinds(out)).not.toContain("виджет-из-будущего");
  });

  it("схлопывает повтор одиночного виджета", () => {
    const out = normalizeLayout([
      { key: "accounts", kind: "accounts" },
      { key: "accounts-2", kind: "accounts" },
    ]);
    expect(kinds(out).filter((k) => k === "accounts")).toHaveLength(1);
  });

  it("схлопывает повтор ключа", () => {
    const out = normalizeLayout([
      { key: "links", kind: "links", links: ["/goals"] },
      { key: "links", kind: "links", links: ["/rules"] },
    ]);
    expect(keys(out).filter((k) => k === "links")).toHaveLength(1);
    expect(row(out, "links").links).toEqual(["/goals"]);
  });

  it("дорожек кнопок разрешает сколько угодно", () => {
    const out = normalizeLayout([
      { key: "links", kind: "links", links: ["/goals"] },
      { key: "links-2", kind: "links", links: ["/rules", "/tags"] },
      { key: "links-3", kind: "links", links: ["/trash"] },
    ]);
    expect(out.filter((p) => p.kind === "links")).toHaveLength(3);
  });

  it("чистит состав дорожки: неизвестное, повторы и лишнее сверх шести", () => {
    const out = normalizeLayout([
      {
        key: "links",
        kind: "links",
        links: [
          "/goals",
          "/goals", // повтор
          "/раздел-которого-нет",
          42,
          "/rules",
          "/tags",
          "/compare",
          "/dynamics",
          "/trends",
          "/top", // седьмая — уже не влезает
        ],
      },
    ]);
    const links = row(out, "links").links!;
    expect(links).toHaveLength(MAX_LINKS);
    expect(links).toEqual(["/goals", "/rules", "/tags", "/compare", "/dynamics", "/trends"]);
  });

  it("дорожку без единой живой кнопки выбрасывает", () => {
    const out = normalizeLayout([
      { key: "links", kind: "links", links: ["/раздела-больше-нет"] },
      { key: "accounts", kind: "accounts" },
    ]);
    expect(kinds(out)).not.toContain("links");
  });

  it("снятую дорожку обратно не подсовывает", () => {
    // Одиночные виджеты, которых в раскладке нет, возвращаются — они
    // «появились в новой версии». Дорожки заводят руками, и вернуть снятую
    // против воли человека нельзя.
    const saved = DEFAULT_LAYOUT.filter((p) => p.kind !== "links");
    const out = normalizeLayout(saved);
    expect(kinds(out)).not.toContain("links");
    expect(out).toHaveLength(WIDGETS.length - 1);
  });

  it("помнит убранные виджеты", () => {
    const out = normalizeLayout([{ key: "observations", kind: "observations", hidden: true }]);
    expect(row(out, "observations").hidden).toBe(true);
    expect(out.filter((p) => p.hidden)).toHaveLength(1);
  });

  it("новый виджет встаёт к своим соседям, а не в конец", () => {
    // Как если бы «Расходы по категориям» появились в новой версии.
    const saved = DEFAULT_LAYOUT.filter((p) => p.kind !== "categories");
    expect(kinds(normalizeLayout(saved))).toEqual(kinds(DEFAULT_LAYOUT));
  });

  it("держится порядка человека, дополняя его по стандартному", () => {
    const out = normalizeLayout([
      { key: "observations", kind: "observations" },
      { key: "month", kind: "month" },
    ]);
    expect(kinds(out)).toEqual([
      "observations",
      "month",
      "accounts",
      "upcoming",
      "cashflow",
      "categories",
      "activity",
    ]);
  });
});

describe("moveWidget", () => {
  it("переносит вперёд", () => {
    const out = moveWidget(DEFAULT_LAYOUT, "month", "upcoming");
    expect(keys(out).slice(0, 3)).toEqual(["accounts", "upcoming", "month"]);
  });

  it("переносит назад", () => {
    const out = moveWidget(DEFAULT_LAYOUT, "observations", "month");
    expect(keys(out)[0]).toBe("observations");
    expect(out).toHaveLength(DEFAULT_LAYOUT.length);
  });

  it("различает две дорожки по ключу", () => {
    const two = addLinksRow(DEFAULT_LAYOUT);
    const out = moveWidget(two, "links-2", "links");
    expect(keys(out).filter((k) => k.startsWith("links"))).toEqual(["links-2", "links"]);
  });

  it("на своё же место и по чужому ключу — ничего не меняет", () => {
    expect(keys(moveWidget(DEFAULT_LAYOUT, "month", "month"))).toEqual(keys(DEFAULT_LAYOUT));
    expect(keys(moveWidget(DEFAULT_LAYOUT, "https://example.com", "month"))).toEqual(
      keys(DEFAULT_LAYOUT)
    );
  });
});

describe("shiftWidget", () => {
  it("меняет местами с соседом", () => {
    const out = shiftWidget(DEFAULT_LAYOUT, "accounts", -1);
    expect(keys(out).slice(0, 2)).toEqual(["accounts", "month"]);
  });

  it("на краю стоит на месте", () => {
    expect(keys(shiftWidget(DEFAULT_LAYOUT, "month", -1))).toEqual(keys(DEFAULT_LAYOUT));
    expect(keys(shiftWidget(DEFAULT_LAYOUT, "observations", 1))).toEqual(keys(DEFAULT_LAYOUT));
  });

  it("перешагивает убранные: шаг не должен уходить в пустоту", () => {
    const layout = setWidgetHidden(DEFAULT_LAYOUT, "accounts", true);
    const out = shiftWidget(layout, "month", 1);
    expect(keys(out).slice(0, 3)).toEqual(["upcoming", "accounts", "month"]);
  });
});

describe("видимость", () => {
  it("убирает и возвращает на то же место", () => {
    const hidden = setWidgetHidden(DEFAULT_LAYOUT, "cashflow", true);
    expect(row(hidden, "cashflow").hidden).toBe(true);
    expect(keys(hidden)).toEqual(keys(DEFAULT_LAYOUT));

    const back = setWidgetHidden(hidden, "cashflow", false);
    expect(row(back, "cashflow").hidden).toBeUndefined();
    expect(back).toEqual(DEFAULT_LAYOUT);
  });

  it("убранная дорожка не теряет своих кнопок", () => {
    const hidden = setWidgetHidden(DEFAULT_LAYOUT, "links", true);
    expect(row(hidden, "links").links).toEqual(DEFAULT_LINKS);
  });
});

describe("дорожки кнопок", () => {
  it("новая дорожка получает свободный ключ", () => {
    const one = addLinksRow(DEFAULT_LAYOUT);
    expect(keys(one)).toContain("links-2");
    const two = addLinksRow(one);
    expect(keys(two)).toContain("links-3");
  });

  it("новая дорожка встаёт в конец с одной кнопкой", () => {
    const out = addLinksRow(DEFAULT_LAYOUT);
    const added = out[out.length - 1];
    expect(added.kind).toBe("links");
    expect(added.links).toHaveLength(1);
    // Первый раздел «Ещё», которого ещё нет ни на одной дорожке.
    expect(DEFAULT_LINKS).not.toContain(added.links![0]);
  });

  it("на пустой главной дорожка всё равно заводится", () => {
    const out = addLinksRow([]);
    expect(out).toHaveLength(1);
    expect(out[0].links).toHaveLength(1);
  });

  it("состав дорожки чистится и обрезается", () => {
    const out = setRowLinks(DEFAULT_LAYOUT, "links", [
      "/goals",
      "/goals",
      "/чепуха",
      "/rules",
      "/tags",
      "/compare",
      "/dynamics",
      "/trends",
      "/top",
    ]);
    expect(row(out, "links").links).toHaveLength(MAX_LINKS);
  });

  it("последнюю кнопку убрать нельзя", () => {
    const one = setRowLinks(DEFAULT_LAYOUT, "links", ["/goals"]);
    expect(row(one, "links").links).toEqual(["/goals"]);
    // Пустой список — не изменение, а попытка оставить полосу без кнопок.
    const still = setRowLinks(one, "links", []);
    expect(row(still, "links").links).toEqual(["/goals"]);
  });

  it("дорожку можно стереть насовсем", () => {
    const two = addLinksRow(DEFAULT_LAYOUT);
    const out = removeWidget(two, "links-2");
    expect(keys(out)).toEqual(keys(DEFAULT_LAYOUT));
  });

  it("одиночный виджет стереть нельзя — его неоткуда вернуть", () => {
    expect(keys(removeWidget(DEFAULT_LAYOUT, "accounts"))).toEqual(keys(DEFAULT_LAYOUT));
    expect(keys(removeWidget(DEFAULT_LAYOUT, "чужой-ключ"))).toEqual(keys(DEFAULT_LAYOUT));
  });

  it("трогает только свою дорожку", () => {
    const two = addLinksRow(DEFAULT_LAYOUT);
    const out = setRowLinks(two, "links-2", ["/trash", "/duplicates"]);
    expect(row(out, "links").links).toEqual(DEFAULT_LINKS);
    expect(row(out, "links-2").links).toEqual(["/trash", "/duplicates"]);
  });
});

describe("isDefaultLayout", () => {
  it("узнаёт стандартную раскладку", () => {
    expect(isDefaultLayout(DEFAULT_LAYOUT)).toBe(true);
    expect(isDefaultLayout(layoutFromStored(null))).toBe(true);
    expect(isDefaultLayout(normalizeLayout(DEFAULT_LAYOUT))).toBe(true);
  });

  it("видит любое отличие", () => {
    expect(isDefaultLayout(setWidgetHidden(DEFAULT_LAYOUT, "categories", true))).toBe(false);
    expect(isDefaultLayout(moveWidget(DEFAULT_LAYOUT, "month", "accounts"))).toBe(false);
    expect(isDefaultLayout(addLinksRow(DEFAULT_LAYOUT))).toBe(false);
    expect(isDefaultLayout(setRowLinks(DEFAULT_LAYOUT, "links", ["/goals"]))).toBe(false);
    expect(isDefaultLayout(DEFAULT_LAYOUT.slice(1))).toBe(false);
  });
});

describe("реестр виджетов", () => {
  it("у каждого виджета есть ширина, название и пояснение", () => {
    for (const w of WIDGETS) {
      expect([1, 2, 3]).toContain(w.span);
      expect(w.title.length).toBeGreaterThan(0);
      expect(w.hint.length).toBeGreaterThan(0);
    }
  });

  it("виды не повторяются", () => {
    expect(new Set(WIDGETS.map((w) => w.kind)).size).toBe(WIDGETS.length);
  });

  it("кнопки по умолчанию — настоящие разделы, и их ровно шесть", () => {
    expect(DEFAULT_LINKS).toHaveLength(MAX_LINKS);
    expect(row(DEFAULT_LAYOUT, "links").links).toEqual(DEFAULT_LINKS);
  });
});
