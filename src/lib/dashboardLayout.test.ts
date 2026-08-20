import { describe, it, expect } from "vitest";
import {
  DEFAULT_LAYOUT,
  DEFAULT_LINKS,
  LINK_SLOTS,
  WIDGETS,
  addLinksRow,
  isDefaultLayout,
  layoutFromStored,
  moveWidget,
  moveWidgetBefore,
  normalizeLayout,
  packLayout,
  removeWidget,
  isBareWidget,
  setRowLinks,
  setWidgetHidden,
  setWidgetView,
  shiftWidget,
  widgetMeta,
  widgetView,
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
    // Полоску сняли руками — обратно она не возвращается.
    const saved = DEFAULT_LAYOUT.filter((p) => p.kind !== "links");
    expect(kinds(layoutFromStored(saved))).not.toContain("links");
  });
});

describe("normalizeLayout", () => {
  it("из пустого списка собирает все одиночные виджеты", () => {
    // Полоски среди них нет: её заводят руками.
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
    expect(row(out, "links").links).toEqual(["/goals", null, null, null, null, null]);
  });

  it("полосок кнопок разрешает сколько угодно", () => {
    const out = normalizeLayout([
      { key: "links", kind: "links", links: ["/goals"] },
      { key: "links-2", kind: "links", links: ["/rules", "/tags"] },
      { key: "links-3", kind: "links", links: ["/trash"] },
    ]);
    expect(out.filter((p) => p.kind === "links")).toHaveLength(3);
  });

  it("чистит места полоски, не сдвигая уцелевшие кнопки", () => {
    const out = normalizeLayout([
      {
        key: "links",
        kind: "links",
        links: [
          "/goals",
          "/goals", // повтор — место останется пустым
          "/раздела-нет",
          42,
          "/rules",
          null,
          "/trends", // седьмое место — его уже нет
        ],
      },
    ]);
    const links = row(out, "links").links!;
    expect(links).toHaveLength(LINK_SLOTS);
    expect(links).toEqual(["/goals", null, null, null, "/rules", null]);
  });

  it("короткий список дополняет пустыми местами", () => {
    const out = normalizeLayout([{ key: "links", kind: "links", links: ["/goals", "/rules"] }]);
    expect(row(out, "links").links).toEqual(["/goals", "/rules", null, null, null, null]);
  });

  it("полоску без единой живой кнопки выбрасывает", () => {
    const out = normalizeLayout([
      { key: "links", kind: "links", links: ["/раздела-больше-нет", null] },
      { key: "accounts", kind: "accounts" },
    ]);
    expect(kinds(out)).not.toContain("links");
  });

  it("снятую полоску обратно не подсовывает", () => {
    // Одиночные виджеты, которых в раскладке нет, возвращаются — они
    // «появились в новой версии». Полоски заводят руками, и вернуть снятую
    // против воли человека нельзя.
    const saved = DEFAULT_LAYOUT.filter((p) => p.kind !== "links");
    const out = normalizeLayout(saved);
    expect(kinds(out)).not.toContain("links");
    expect(out).toHaveLength(WIDGETS.length - 1);
  });

  it("помнит убранные виджеты", () => {
    const out = normalizeLayout([{ key: "observations", kind: "observations", hidden: true }]);
    expect(row(out, "observations").hidden).toBe(true);
    // Кроме него сняты только те, что и в стандартной раскладке лежат на полке.
    expect([...out.filter((p) => p.hidden).map((p) => p.kind)].sort()).toEqual([
      "donutExpense",
      "donutIncome",
      "observations",
    ]);
  });

  it("стандартно снятый виджет приходит в чужую раскладку снятым", () => {
    // Кольца заводились уже после полоски: в сохранённой раскладке их нет, и
    // сами собой посреди собранной главной они вставать не должны.
    const saved = DEFAULT_LAYOUT.filter((p) => !p.kind.startsWith("donut"));
    const out = normalizeLayout(saved);
    expect(row(out, "donutExpense").hidden).toBe(true);
    expect(row(out, "donutIncome").hidden).toBe(true);
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
    // Кольца стоят сразу за «наблюдениями» — там их место по стандартному
    // порядку, а «наблюдения» в сохранённой раскладке первые.
    expect(kinds(out)).toEqual([
      "observations",
      "donutExpense",
      "donutIncome",
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

  it("различает две полоски по ключу", () => {
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

describe("moveWidgetBefore", () => {
  it("ставит перед названным виджетом", () => {
    const out = moveWidgetBefore(DEFAULT_LAYOUT, "observations", "accounts");
    expect(keys(out).slice(0, 3)).toEqual(["month", "observations", "accounts"]);
  });

  it("с `null` — в самый конец", () => {
    const out = moveWidgetBefore(DEFAULT_LAYOUT, "month", null);
    expect(keys(out)[keys(out).length - 1]).toBe("month");
    expect(out).toHaveLength(DEFAULT_LAYOUT.length);
  });

  it("по чужому ключу ничего не меняет", () => {
    expect(keys(moveWidgetBefore(DEFAULT_LAYOUT, "чужой", "month"))).toEqual(
      keys(DEFAULT_LAYOUT)
    );
    expect(keys(moveWidgetBefore(DEFAULT_LAYOUT, "month", "чужой"))).toEqual(
      keys(DEFAULT_LAYOUT)
    );
  });
});

describe("packLayout", () => {
  const cell = (kind: string, key = kind): WidgetPlacement => ({ key, kind: kind as never });

  it("в стандартной раскладке дырок внутри нет", () => {
    // Раскладывается только видимое — как на самой главной.
    const visible = DEFAULT_LAYOUT.filter((p) => !p.hidden);
    // Стандартная главная собрана в ровные ряды: ни дырки перед виджетом,
    // которая означала бы криво собранный ряд, ни хвостового остатка.
    expect(packLayout(visible).filter((c) => c.type === "gap")).toEqual([]);
  });

  it("называет дырку перед тем, кто в ряд не влез", () => {
    // Две трети и ещё две трети: вторая уезжает ниже, за первой остаётся треть.
    const out = packLayout([cell("cashflow"), cell("activity")]);
    expect(out).toEqual([
      { type: "widget", placement: cell("cashflow") },
      { type: "gap", span: 1, before: "activity" },
      { type: "widget", placement: cell("activity") },
      { type: "gap", span: 1, before: null },
    ]);
  });

  it("хвостовую дырку отдаёт с `null`", () => {
    const out = packLayout([cell("month"), cell("accounts")]);
    expect(out[out.length - 1]).toEqual({ type: "gap", span: 1, before: null });
  });

  it("полный ряд хвостовой дырки не оставляет", () => {
    const out = packLayout([cell("month"), cell("accounts"), cell("upcoming")]);
    expect(out.filter((c) => c.type === "gap")).toHaveLength(0);
  });

  it("виджет во всю строку встаёт на новый ряд, а за прошлым остаётся дырка", () => {
    const out = packLayout([cell("month"), cell("links")]);
    expect(out[1]).toEqual({ type: "gap", span: 2, before: "links" });
  });
});

describe("shiftWidget", () => {
  it("меняет местами с соседом", () => {
    const out = shiftWidget(DEFAULT_LAYOUT, "accounts", -1);
    expect(keys(out).slice(0, 2)).toEqual(["accounts", "month"]);
  });

  it("на краю стоит на месте", () => {
    expect(keys(shiftWidget(DEFAULT_LAYOUT, "month", -1))).toEqual(keys(DEFAULT_LAYOUT));
    const last = DEFAULT_LAYOUT[DEFAULT_LAYOUT.length - 1].key;
    expect(keys(shiftWidget(DEFAULT_LAYOUT, last, 1))).toEqual(keys(DEFAULT_LAYOUT));
  });

  it("перешагивает убранные: шаг не должен уходить в пустоту", () => {
    const layout = setWidgetHidden(DEFAULT_LAYOUT, "accounts", true);
    const out = shiftWidget(layout, "month", 1);
    expect(keys(out).slice(0, 3)).toEqual(["upcoming", "accounts", "month"]);
  });
});

describe("видимость", () => {
  it("убирает, не сдвигая соседей", () => {
    const hidden = setWidgetHidden(DEFAULT_LAYOUT, "cashflow", true);
    expect(row(hidden, "cashflow").hidden).toBe(true);
    expect(keys(hidden)).toEqual(keys(DEFAULT_LAYOUT));
  });

  it("возвращает в конец, а не на прежнее место", () => {
    // Прежнее место к этому времени занято: соседи сомкнулись, и виджет,
    // всплывающий посреди раскладки, читался бы сбоем.
    const hidden = setWidgetHidden(DEFAULT_LAYOUT, "cashflow", true);
    const back = setWidgetHidden(hidden, "cashflow", false);
    expect(row(back, "cashflow").hidden).toBeUndefined();
    expect(keys(back)[keys(back).length - 1]).toBe("cashflow");
    expect(back).toHaveLength(DEFAULT_LAYOUT.length);
  });

  it("убранная полоска не теряет своих кнопок", () => {
    const hidden = setWidgetHidden(DEFAULT_LAYOUT, "links", true);
    expect(row(hidden, "links").links).toEqual(DEFAULT_LINKS);
  });
});

describe("полоски с кнопками", () => {
  it("новая полоска получает свободный ключ", () => {
    const one = addLinksRow(DEFAULT_LAYOUT);
    expect(keys(one)).toContain("links-2");
    const two = addLinksRow(one);
    expect(keys(two)).toContain("links-3");
  });

  it("новая полоска встаёт в конец с одной кнопкой на первом месте", () => {
    const out = addLinksRow(DEFAULT_LAYOUT);
    const added = out[out.length - 1];
    expect(added.kind).toBe("links");
    expect(added.links).toHaveLength(LINK_SLOTS);
    expect(added.links!.filter(Boolean)).toHaveLength(1);
    // Первый раздел «Ещё», которого ещё нет ни на одной полоске.
    expect(DEFAULT_LINKS).not.toContain(added.links![0]);
  });

  it("на пустой главной полоска всё равно заводится", () => {
    const out = addLinksRow([]);
    expect(out).toHaveLength(1);
    expect(out[0].links!.filter(Boolean)).toHaveLength(1);
  });

  it("кнопки можно расставить по местам как угодно", () => {
    const out = setRowLinks(DEFAULT_LAYOUT, "links", [
      "/goals",
      null,
      null,
      "/rules",
      null,
      "/trash",
    ]);
    expect(row(out, "links").links).toEqual(["/goals", null, null, "/rules", null, "/trash"]);
  });

  it("полоску без единой кнопки не принимает", () => {
    const one = setRowLinks(DEFAULT_LAYOUT, "links", ["/goals"]);
    expect(row(one, "links").links).toEqual(["/goals", null, null, null, null, null]);
    const still = setRowLinks(one, "links", [null, null, null, null, null, null]);
    expect(row(still, "links").links).toEqual(["/goals", null, null, null, null, null]);
  });

  it("полоску можно стереть насовсем", () => {
    const two = addLinksRow(DEFAULT_LAYOUT);
    const out = removeWidget(two, "links-2");
    expect(keys(out)).toEqual(keys(DEFAULT_LAYOUT));
  });

  it("одиночный виджет стереть нельзя — его неоткуда вернуть", () => {
    expect(keys(removeWidget(DEFAULT_LAYOUT, "accounts"))).toEqual(keys(DEFAULT_LAYOUT));
    expect(keys(removeWidget(DEFAULT_LAYOUT, "чужой-ключ"))).toEqual(keys(DEFAULT_LAYOUT));
  });

  it("трогает только свою полоску", () => {
    const two = addLinksRow(DEFAULT_LAYOUT);
    const out = setRowLinks(two, "links-2", ["/trash", "/duplicates"]);
    expect(row(out, "links").links).toEqual(DEFAULT_LINKS);
    expect(row(out, "links-2").links).toEqual([
      "/trash",
      "/duplicates",
      null,
      null,
      null,
      null,
    ]);
  });
});

describe("варианты оформления", () => {
  it("утопленная подложка — свойство варианта, а не виджета", () => {
    const month = widgetMeta("month");
    expect(widgetView(month, "framed")?.sunken).toBe(true);
    expect(widgetView(month, "open")?.sunken).toBeUndefined();
    expect(widgetView(month, "split")?.sunken).toBeUndefined();
  });

  it("порядок видов: открытый, в рамке, разворот", () => {
    expect(widgetMeta("month").views?.map((v) => v.id)).toEqual([
      "open",
      "framed",
      "split",
    ]);
  });

  it("выбирает известный вариант", () => {
    const out = setWidgetView(DEFAULT_LAYOUT, "month", "split");
    expect(row(out, "month").view).toBe("split");
  });

  it("неизвестный вариант не берёт", () => {
    const out = setWidgetView(DEFAULT_LAYOUT, "month", "карусель");
    expect(row(out, "month").view).toBeUndefined();
  });

  it("виджету без вариантов вариант не ставит", () => {
    const out = setWidgetView(DEFAULT_LAYOUT, "accounts", "split");
    expect(row(out, "accounts").view).toBeUndefined();
  });

  it("возврат к варианту по умолчанию стирает запись", () => {
    const split = setWidgetView(DEFAULT_LAYOUT, "month", "split");
    const back = setWidgetView(split, "month", "open");
    expect(row(back, "month").view).toBeUndefined();
    // И раскладка снова считается стандартной.
    expect(isDefaultLayout(back)).toBe(true);
  });

  it("сохранённый вариант переживает разбор, выдуманный — нет", () => {
    const ok = normalizeLayout([{ key: "month", kind: "month", view: "split" }]);
    expect(row(ok, "month").view).toBe("split");
    const junk = normalizeLayout([{ key: "month", kind: "month", view: "карусель" }]);
    expect(row(junk, "month").view).toBeUndefined();
  });

  it("убранный виджет не теряет своего варианта", () => {
    const split = setWidgetView(DEFAULT_LAYOUT, "month", "split");
    expect(row(setWidgetHidden(split, "month", true), "month").view).toBe("split");
  });

  it("неизвестный или пустой вариант читается как первый", () => {
    const month = widgetMeta("month");
    expect(widgetView(month, undefined)?.id).toBe("open");
    expect(widgetView(month, "карусель")?.id).toBe("open");
    expect(widgetView(month, "split")?.id).toBe("split");
    expect(widgetView(month, "framed")?.id).toBe("framed");
    // У виджета без вариантов их и нет.
    expect(widgetView(widgetMeta("accounts"), "open")).toBeUndefined();
  });

  it("поддон надевается по варианту, а не только по виду", () => {
    const month = widgetMeta("month");
    expect(isBareWidget(month, "open")).toBe(true);
    expect(isBareWidget(month, "split")).toBe(false);
    expect(isBareWidget(month, "framed")).toBe(false);
    expect(isBareWidget(month, undefined)).toBe(true);
    // Полоска с кнопками рисует себя сама всегда — вариантов у неё нет.
    expect(isBareWidget(widgetMeta("links"))).toBe(true);
    expect(isBareWidget(widgetMeta("accounts"))).toBe(false);
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
    expect(isDefaultLayout(setWidgetView(DEFAULT_LAYOUT, "month", "split"))).toBe(false);
    expect(isDefaultLayout(setRowLinks(DEFAULT_LAYOUT, "links", ["/goals"]))).toBe(false);
    expect(
      isDefaultLayout(setRowLinks(DEFAULT_LAYOUT, "links", [null, ...DEFAULT_LINKS.slice(1)]))
    ).toBe(false);
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

  it("у вариантов оформления имена не повторяются и все подписаны", () => {
    for (const w of WIDGETS) {
      if (!w.views) continue;
      expect(w.views.length).toBeGreaterThan(1);
      expect(new Set(w.views.map((v) => v.id)).size).toBe(w.views.length);
      for (const v of w.views) {
        expect(v.title.length).toBeGreaterThan(0);
        expect(v.hint.length).toBeGreaterThan(0);
      }
    }
  });

  it("виды не повторяются", () => {
    expect(new Set(WIDGETS.map((w) => w.kind)).size).toBe(WIDGETS.length);
  });

  it("кнопки по умолчанию занимают все шесть мест", () => {
    expect(DEFAULT_LINKS).toHaveLength(LINK_SLOTS);
    expect(DEFAULT_LINKS.every(Boolean)).toBe(true);
    expect(row(DEFAULT_LAYOUT, "links").links).toEqual(DEFAULT_LINKS);
  });
});
