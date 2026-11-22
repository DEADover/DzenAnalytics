import { describe, it, expect } from "vitest";
import {
  DEFAULT_LAYOUT,
  DEFAULT_LINKS,
  LINK_SLOTS,
  WIDGETS,
  addLinksRow,
  addWidget,
  setWidgetCategory,
  setWidgetTag,
  isDefaultLayout,
  layoutFromStored,
  swapWidgets,
  canShiftWidget,
  canDropIntoGap,
  moveWidgetBefore,
  normalizeLayout,
  dropIntoGap,
  packLayout,
  removeWidget,
  isBareWidget,
  setRowLinks,
  setWidgetHidden,
  setWidgetOffBalance,
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

  it("полоска с несуществующим разделом остаётся пустой, а не пропадает", () => {
    // Пустая полоска — законное состояние: человек расставит кнопки сам.
    // Выбрасывать её значило бы решать за него, что она ему не нужна.
    const out = normalizeLayout([
      { key: "links", kind: "links", links: ["/раздела-больше-нет", null] },
      { key: "accounts", kind: "accounts" },
    ]);
    expect(row(out, "links").links).toEqual([null, null, null, null, null, null]);
  });

  it("снятую полоску обратно не подсовывает", () => {
    // Одиночные виджеты, которых в раскладке нет, возвращаются — они
    // «появились в новой версии». Полоски заводят руками, и вернуть снятую
    // против воли человека нельзя.
    const saved = DEFAULT_LAYOUT.filter((p) => p.kind !== "links");
    const out = normalizeLayout(saved);
    expect(kinds(out)).not.toContain("links");
    // Без полоски и без видов, которые заводят только руками.
    expect(out).toHaveLength(WIDGETS.filter((w) => !w.multi).length);
  });

  it("помнит убранные виджеты", () => {
    const out = normalizeLayout([{ key: "observations", kind: "observations", hidden: true }]);
    expect(row(out, "observations").hidden).toBe(true);
    // Кроме него сняты только те, что и в стандартной раскладке лежат на полке.
    expect([...out.filter((p) => p.hidden).map((p) => p.kind)].sort()).toEqual([
      "bigExpenses",
      "budget",
      "capital",
      "cushion",
      "donutExpense",
      "donutIncome",
      "freeMoney",
      "freeMoneyCompact",
      "goals",
      "monthOverMonth",
      "observations",
      "pace",
      "triage",
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
    // порядку, а «наблюдения» в сохранённой раскладке первые. «Активность» по
    // стандартному порядку идёт ПЕРЕД «наблюдениями», и опереться ей не на
    // что: такие уходят в конец.
    expect(kinds(out)).toEqual([
      "observations",
      "donutExpense",
      "donutIncome",
      "pace",
      "triage",
      "budget",
      "goals",
      "bigExpenses",
      "cushion",
      "month",
      "accounts",
      "upcoming",
      "freeMoney",
      "freeMoneyCompact",
      "cashflow",
      "capital",
      "monthOverMonth",
      "categories",
      "activity",
    ]);
  });
});

/** Ряды главной как их видит человек: «month | accounts | ·1». */
function rows(layout: readonly WidgetPlacement[]): string[] {
  const out: string[] = [];
  let row: string[] = [];
  let col = 0;
  for (const c of packLayout(layout.filter((p) => !p.hidden))) {
    const span = c.type === "gap" ? c.span : widgetMeta(c.placement.kind).span;
    row.push(c.type === "gap" ? `·${span}` : c.placement.key);
    col += span;
    if (col >= 3) {
      out.push(row.join(" | "));
      row = [];
      col = 0;
    }
  }
  if (row.length) out.push(row.join(" | "));
  return out;
}

describe("swapWidgets", () => {
  it("меняет два виджета местами, остальные стоят где стояли", () => {
    // Из последнего ряда в первый: раньше это перекраивало каждую строку.
    expect(rows(swapWidgets(DEFAULT_LAYOUT, "observations", "month"))).toEqual([
      "observations | accounts | upcoming",
      "links",
      "cashflow | categories",
      "activity | month",
    ]);
  });

  it("не зависит от того, кого на кого бросили", () => {
    expect(swapWidgets(DEFAULT_LAYOUT, "month", "observations")).toEqual(
      swapWidgets(DEFAULT_LAYOUT, "observations", "month")
    );
  });

  it("пустая клетка слева остаётся за местом, а не уезжает с виджетом", () => {
    // «Балансы» сдвинуты вправо: month | · | accounts.
    let layout = setWidgetHidden(DEFAULT_LAYOUT, "upcoming", true);
    layout = shiftWidget(layout, "accounts", 1);
    expect(rows(layout)[0]).toBe("month | ·1 | accounts");
    expect(rows(swapWidgets(layout, "accounts", "categories"))).toEqual([
      "month | ·1 | categories",
      "links",
      "cashflow | accounts",
      "activity | observations",
    ]);
  });

  it("различает две полоски по ключу", () => {
    const two = addLinksRow(DEFAULT_LAYOUT);
    const out = swapWidgets(two, "links-2", "links");
    expect(keys(out).filter((k) => k.startsWith("links"))).toEqual(["links-2", "links"]);
  });

  it("на своё же место и по чужому ключу — ничего не меняет", () => {
    expect(keys(swapWidgets(DEFAULT_LAYOUT, "month", "month"))).toEqual(keys(DEFAULT_LAYOUT));
    expect(keys(swapWidgets(DEFAULT_LAYOUT, "https://example.com", "month"))).toEqual(
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

  it("в стандартной раскладке дырок ВНУТРИ нет", () => {
    // Раскладывается только видимое — как на самой главной.
    const visible = DEFAULT_LAYOUT.filter((p) => !p.hidden);
    // Дырка ПЕРЕД виджетом означала бы криво собранный ряд — такой быть не
    // должно. Хвостовой остаток допустим: после «Свободных денег» (две трети)
    // ширины видимых виджетов складываются в 14 третей, а 14 на три не делится.
    // Хвост стоит в самом низу страницы, где за ним всё равно ничего нет.
    const gaps = packLayout(visible).filter((c) => c.type === "gap");
    expect(gaps.filter((g) => g.type === "gap" && g.before !== null)).toEqual([]);
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
  it("рядом сосед — меняются местами с первого нажатия, дыр не появляется", () => {
    // Раньше первое нажатие оставляло слева дыру и выталкивало «Запланированные»
    // на новый ряд; местами виджеты менялись только с третьего.
    const out = shiftWidget(DEFAULT_LAYOUT, "month", 1);
    expect(rows(out)).toEqual([
      "accounts | month | upcoming",
      "links",
      "cashflow | categories",
      "activity | observations",
    ]);
    expect(rows(shiftWidget(out, "month", -1))).toEqual(rows(DEFAULT_LAYOUT));
  });

  it("рядом пустая клетка — виджет встаёт в неё, соседи на месте", () => {
    let layout = setWidgetHidden(DEFAULT_LAYOUT, "upcoming", true);
    expect(rows(layout)[0]).toBe("month | accounts | ·1");
    layout = shiftWidget(layout, "accounts", 1);
    expect(rows(layout)[0]).toBe("month | ·1 | accounts");
    // «Итоги» шагают в освободившуюся клетку — «Балансы» остаются справа.
    const both = shiftWidget(layout, "month", 1);
    expect(rows(both)[0]).toBe("·1 | month | accounts");
    // И обратно: клетка возвращается, «Балансы» по-прежнему справа.
    expect(rows(shiftWidget(both, "month", -1))[0]).toBe("month | ·1 | accounts");
    expect(rows(shiftWidget(layout, "accounts", -1))[0]).toBe("month | accounts | ·1");
  });

  it("виджет в две трети шагает в свободную треть ряда", () => {
    let layout = setWidgetHidden(DEFAULT_LAYOUT, "categories", true);
    expect(rows(layout)[2]).toBe("cashflow | ·1");
    layout = shiftWidget(layout, "cashflow", 1);
    expect(rows(layout)[2]).toBe("·1 | cashflow");
    expect(rows(shiftWidget(layout, "cashflow", -1))[2]).toBe("cashflow | ·1");
  });

  it("через ряд — обмен с ближайшим виджетом в порядке чтения", () => {
    const out = shiftWidget(DEFAULT_LAYOUT, "cashflow", 1);
    expect(rows(out)[2]).toBe("categories | cashflow");
    expect(rows(shiftWidget(DEFAULT_LAYOUT, "links", -1)).slice(0, 3)).toEqual([
      "month | accounts | ·1",
      "links",
      "upcoming | cashflow",
    ]);
  });

  it("на краю стоит на месте, и стрелка это знает", () => {
    expect(shiftWidget(DEFAULT_LAYOUT, "month", -1)).toEqual(DEFAULT_LAYOUT.slice());
    expect(canShiftWidget(DEFAULT_LAYOUT, "month", -1)).toBe(false);
    expect(canShiftWidget(DEFAULT_LAYOUT, "month", 1)).toBe(true);
    const last = DEFAULT_LAYOUT.filter((p) => !p.hidden).at(-1)!.key;
    expect(canShiftWidget(DEFAULT_LAYOUT, last, 1)).toBe(false);
    expect(canShiftWidget(DEFAULT_LAYOUT, last, -1)).toBe(true);
  });

  it("перешагивает убранные: шаг не должен уходить в пустоту", () => {
    const layout = setWidgetHidden(DEFAULT_LAYOUT, "accounts", true);
    // Справа от «Итогов» теперь «Запланированные» — с ними и меняются.
    const out = shiftWidget(layout, "month", 1);
    expect(rows(out)[0]).toBe("upcoming | month | ·1");
    expect(out.find((p) => p.key === "accounts")?.hidden).toBe(true);
  });
});

describe("dropIntoGap", () => {
  const cols = (l: readonly WidgetPlacement[]) =>
    packLayout(l).map((c) => (c.type === "widget" ? c.placement.key : `gap${c.span}`));

  // Ряд из двух виджетов в треть и дырки: следом идёт виджет в две трети,
  // который в остаток ряда не влез.
  const row = [
    { key: "upcoming", kind: "upcoming" as const },
    { key: "accounts", kind: "accounts" as const },
    { key: "freeMoney", kind: "freeMoney" as const },
  ];

  it("виджет из СВОЕГО ряда встаёт на место дырки", () => {
    // Раньше он просто менялся местами с соседом, а дырка оставалась там же —
    // со стороны это выглядело как «перетаскивание не работает».
    // Сосед по ряду остаётся в своей колонке: пустая клетка переезжает туда,
    // откуда виджет ушёл, а не оказывается посреди ряда.
    const out = dropIntoGap(row, "upcoming", "freeMoney", 2);
    expect(cols(out)).toEqual(["gap1", "accounts", "upcoming", "freeMoney", "gap1"]);
  });

  it("сосед по ряду тоже встаёт на место дырки, а первый остаётся слева", () => {
    const out = dropIntoGap(row, "accounts", "freeMoney", 2);
    expect(cols(out)).toEqual(["upcoming", "gap1", "accounts", "freeMoney", "gap1"]);
  });

  it("виджет из ДРУГОГО ряда просто заполняет дырку, без отступа", () => {
    const layout = [...row, { key: "categories", kind: "categories" as const }];
    const out = dropIntoGap(layout, "categories", "freeMoney", 2);
    expect(cols(out)).toEqual(["upcoming", "accounts", "categories", "freeMoney", "gap1"]);
    expect(out.find((p) => p.key === "categories")?.offset).toBeUndefined();
  });

  it("бросок в собственный отступ двигает виджет влево", () => {
    // Дырка слева от виджета — его же отступ; бросок в неё её и убирает.
    const layout = [
      { key: "freeMoney", kind: "freeMoney" as const, offset: 1 },
      { key: "categories", kind: "categories" as const },
    ];
    const out = dropIntoGap(layout, "freeMoney", "freeMoney", 0);
    expect(cols(out)).toEqual(["freeMoney", "categories"]);
  });

  it("занятый чужой отступ соседу возвращается урезанным", () => {
    // Дырка была отступом «Свободных денег»; её заняли — значит отступа больше
    // нет, иначе виджет уехал бы ещё правее, а дырка выросла.
    const layout = [
      { key: "freeMoney", kind: "freeMoney" as const, offset: 1 },
      { key: "categories", kind: "categories" as const },
    ];
    const out = dropIntoGap(layout, "categories", "freeMoney", 0);
    expect(out.find((p) => p.key === "freeMoney")?.offset).toBeUndefined();
    expect(cols(out)).toEqual(["categories", "freeMoney"]);
  });

  it("незнакомый ключ раскладку не трогает", () => {
    expect(cols(dropIntoGap(row, "чужой", "freeMoney", 2))).toEqual(cols(row));
  });
});

describe("dropIntoGap: виджет под дыркой", () => {
  // Третья клетка первого ряда пуста, а виджет стоит под ней — в третьей клетке
  // второго ряда, куда его отнёс собственный отступ.
  const under: WidgetPlacement[] = [
    { key: "month", kind: "month" },
    { key: "accounts", kind: "accounts" },
    { key: "categories", kind: "categories", offset: 2 },
  ];

  it("исходная раскладка: дырка над виджетом", () => {
    expect(rows(under)).toEqual(["month | accounts | ·1", "·2 | categories"]);
  });

  it("бросок в дырку рядом выше поднимает виджет в неё", () => {
    // Колонка та же, ряд другой: раньше это считалось «сдвигом на ноль клеток»,
    // и виджет оставался где был.
    const out = dropIntoGap(under, "categories", "categories", 2);
    expect(rows(out)).toEqual(["month | accounts | categories"]);
  });

  it("чужой отступ в своём ряду не трогает, когда занимают дырку рядом выше", () => {
    const layout: WidgetPlacement[] = [...under, { key: "observations", kind: "observations" }];
    expect(rows(layout)).toEqual(["month | accounts | ·1", "·2 | categories", "observations | ·2"]);
    // «Наблюдения» встают в дырку первого ряда; «Категории» остаются под ней.
    const out = dropIntoGap(layout, "observations", "categories", 2);
    expect(rows(out)).toEqual(["month | accounts | observations", "·2 | categories"]);
  });
});

describe("перемещение: края и странные случаи", () => {
  it("шаг через полоску во всю ширину не теряет пустую клетку", () => {
    const layout: WidgetPlacement[] = [
      { key: "categories", kind: "categories", offset: 2 },
      { key: "links", kind: "links", links: [null, null, null, null, null, null] },
    ];
    expect(rows(layout)).toEqual(["·2 | categories", "links"]);
    // Полоске отступ не положен — он остаётся у «Категорий», а не стирается.
    expect(rows(shiftWidget(layout, "categories", 1))).toEqual(["links", "·2 | categories"]);
    expect(rows(swapWidgets(swapWidgets(layout, "categories", "links"), "links", "categories"))).toEqual(
      rows(layout)
    );
  });

  it("широкий виджет, брошенный в чужую пустую клетку, не сдвигает соседа в другую колонку", () => {
    const layout: WidgetPlacement[] = [
      { key: "categories", kind: "categories", offset: 1 },
      { key: "links", kind: "links", links: [null, null, null, null, null, null] },
    ];
    expect(rows(layout)).toEqual(["·1 | categories | ·1", "links"]);
    expect(rows(dropIntoGap(layout, "links", "categories", 0))).toEqual([
      "links",
      "·1 | categories | ·1",
    ]);
  });

  it("перенос в свой же ряд: остальные стоят, пустая клетка переезжает", () => {
    const layout: WidgetPlacement[] = [
      { key: "month", kind: "month" },
      { key: "accounts", kind: "accounts" },
    ];
    expect(rows(dropIntoGap(layout, "month", null, 2))).toEqual(["·1 | accounts | month"]);
    const shifted: WidgetPlacement[] = [
      { key: "month", kind: "month", offset: 1 },
      { key: "accounts", kind: "accounts" },
    ];
    expect(rows(shifted)).toEqual(["·1 | month | accounts"]);
    expect(rows(dropIntoGap(shifted, "month", "month", 0))).toEqual(["month | ·1 | accounts"]);
  });

  it("клетка не зовёт, если бросок ничего не изменит или виджет в неё не встанет", () => {
    // Полоска уже стоит прямо перед этой клеткой — переносить её некуда.
    const strip: WidgetPlacement[] = [
      { key: "links", kind: "links", links: [null, null, null, null, null, null] },
      { key: "categories", kind: "categories", offset: 2 },
    ];
    expect(canDropIntoGap(strip, "links", "categories", 0)).toBe(false);

    // Клетка слева от виджета во втором ряду недостижима, пока в первом есть
    // место: раскладка подтянула бы его наверх.
    const under: WidgetPlacement[] = [
      { key: "month", kind: "month" },
      { key: "accounts", kind: "accounts" },
      { key: "categories", kind: "categories", offset: 2 },
    ];
    expect(canDropIntoGap(under, "categories", "categories", 0)).toBe(false);
    // А клетка над ним — зовёт.
    expect(canDropIntoGap(under, "categories", "categories", 2)).toBe(true);
    // Виджет в две трети в последнюю треть ряда не помещается.
    expect(canDropIntoGap([...under, { key: "cashflow", kind: "cashflow" }], "cashflow", "categories", 2)).toBe(false);
    // Чужой ключ и снятый виджет — не наши плитки.
    expect(canDropIntoGap(under, "https://example.com", "categories", 2)).toBe(false);
  });
});

describe("packLayout и отступ", () => {
  it("ставит пустую клетку слева от виджета", () => {
    const out = packLayout([
      { key: "freeMoney", kind: "freeMoney", offset: 1 },
      { key: "categories", kind: "categories" },
    ]);
    expect(out.map((c) => (c.type === "widget" ? c.placement.key : `gap${c.span}`))).toEqual([
      "gap1",
      "freeMoney",
      "categories",
      "gap2",
    ]);
  });

  it("отступ едет вместе с виджетом на новый ряд", () => {
    // Иначе пустота повисла бы хвостом предыдущего ряда, а виджет всё равно
    // встал бы слева — то есть отступ бы просто пропал.
    const out = packLayout([
      { key: "accounts", kind: "accounts" },
      { key: "freeMoney", kind: "freeMoney", offset: 1 },
    ]);
    expect(out.map((c) => (c.type === "widget" ? c.placement.key : `gap${c.span}`))).toEqual([
      "accounts",
      "gap2",
      "gap1",
      "freeMoney",
    ]);
  });

  it("отступ больше свободного места обрезается", () => {
    // У виджета в две трети клетка бывает только одна: с двумя он не влез бы
    // в ряд вовсе.
    const out = packLayout([{ key: "freeMoney", kind: "freeMoney", offset: 9 }]);
    expect(out.map((c) => (c.type === "widget" ? c.placement.key : `gap${c.span}`))).toEqual([
      "gap1",
      "freeMoney",
    ]);
  });

  it("виджету во всю ширину отступ не полагается", () => {
    const out = packLayout([{ key: "links", kind: "links", offset: 2 }]);
    expect(out.map((c) => (c.type === "widget" ? c.placement.key : `gap${c.span}`))).toEqual([
      "links",
    ]);
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

  it("новая полоска встаёт в конец пустой", () => {
    // Пустой — чтобы человек расставил кнопки сам: подобранный за него раздел
    // всё равно менялся на нужный первым же действием.
    const out = addLinksRow(DEFAULT_LAYOUT);
    const added = out[out.length - 1];
    expect(added.kind).toBe("links");
    expect(added.links).toEqual(new Array(LINK_SLOTS).fill(null));
  });

  it("полосок можно завести сколько угодно", () => {
    let out = DEFAULT_LAYOUT.slice();
    for (let i = 0; i < 4; i++) out = addLinksRow(out);
    expect(out.filter((p) => p.kind === "links").map((p) => p.key)).toEqual([
      "links",
      "links-2",
      "links-3",
      "links-4",
      "links-5",
    ]);
  });

  it("на пустой главной полоска всё равно заводится", () => {
    const out = addLinksRow([]);
    expect(out).toHaveLength(1);
    expect(out[0].links).toEqual(new Array(LINK_SLOTS).fill(null));
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

  it("полоску можно опустошить целиком", () => {
    // Пустым местом на экране она не станет: в настройке все шесть мест зовут
    // плюсом, а вне её пустая полоска не рисуется.
    const one = setRowLinks(DEFAULT_LAYOUT, "links", ["/goals"]);
    expect(row(one, "links").links).toEqual(["/goals", null, null, null, null, null]);
    const empty = setRowLinks(one, "links", [null, null, null, null, null, null]);
    expect(row(empty, "links").links).toEqual([null, null, null, null, null, null]);
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

  it("возврат к варианту по умолчанию не трогает остальное место виджета", () => {
    const links = ["/transactions", null, null, null, null, null];
    const placed = DEFAULT_LAYOUT.map((p) =>
      p.key === "month" ? { ...p, offset: 2, hidden: true, links } : p
    );
    const split = setWidgetView(placed, "month", "split");
    expect(row(split, "month")).toMatchObject({ view: "split", offset: 2, hidden: true, links });

    const back = row(setWidgetView(split, "month", "open"), "month");
    expect(back.offset).toBe(2);
    expect(back.hidden).toBe(true);
    expect(back.links).toEqual(links);
    // Вариант по умолчанию не хранится вовсе — даже пустым полем.
    expect("view" in back).toBe(false);
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
    expect(isDefaultLayout(swapWidgets(DEFAULT_LAYOUT, "month", "accounts"))).toBe(false);
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

describe("«Балансы счетов»: счета вне баланса — выбор виджета", () => {
  const acc = (l: readonly { kind: string; offBalance?: boolean }[]) => l.find((p) => p.kind === "accounts");

  it("выбор хранится, «как в настройках» — не хранится", () => {
    const on = setWidgetOffBalance(DEFAULT_LAYOUT, "accounts", true);
    expect(acc(on)?.offBalance).toBe(true);
    expect(acc(setWidgetOffBalance(on, "accounts", false))?.offBalance).toBe(false);
    expect(acc(setWidgetOffBalance(on, "accounts", undefined))).not.toHaveProperty("offBalance");
  });

  it("другим виджетам поле не ставится", () => {
    expect(setWidgetOffBalance(DEFAULT_LAYOUT, "month", true)).toEqual(DEFAULT_LAYOUT);
  });

  it("переживает чтение с диска и с другого устройства", () => {
    const raw = JSON.parse(JSON.stringify(setWidgetOffBalance(DEFAULT_LAYOUT, "accounts", false)));
    expect(acc(normalizeLayout(raw))?.offBalance).toBe(false);
    // Чужое и битое отсекается.
    const junk = normalizeLayout([{ key: "accounts", kind: "accounts", offBalance: "да" }, { key: "month", kind: "month", offBalance: true }]);
    expect(acc(junk)).not.toHaveProperty("offBalance");
    expect(junk.find((p) => p.kind === "month")).not.toHaveProperty("offBalance");
  });
});

describe("виджеты, которых может быть несколько", () => {
  it("«Категории под наблюдением» в стандартной раскладке нет, и сама она не появляется", () => {
    expect(DEFAULT_LAYOUT.some((p) => p.kind === "watch")).toBe(false);
    expect(normalizeLayout([{ key: "month", kind: "month" }]).some((p) => p.kind === "watch")).toBe(false);
  });

  it("заводится сколько угодно, у каждой свой ключ и своя статья", () => {
    let layout = addWidget(DEFAULT_LAYOUT, "watch");
    layout = addWidget(layout, "watch", "month");
    const keys = layout.filter((p) => p.kind === "watch").map((p) => p.key);
    expect(keys).toEqual(["watch-2", "watch"]);
    expect(layout[0].key).toBe("watch-2");

    layout = setWidgetCategory(layout, "watch", "Еда", "Кафе");
    layout = setWidgetCategory(layout, "watch-2", "Дом");
    expect(layout.find((p) => p.key === "watch")).toMatchObject({ category: "Еда", subcategory: "Кафе" });
    expect(layout.find((p) => p.key === "watch-2")).toEqual({ key: "watch-2", kind: "watch", category: "Дом" });

    // Статья переживает сохранение и чтение.
    const back = normalizeLayout(JSON.parse(JSON.stringify(layout)));
    expect(back.find((p) => p.key === "watch")).toMatchObject({ category: "Еда", subcategory: "Кафе" });

    // Удаляется насовсем, как полоска.
    expect(removeWidget(back, "watch").some((p) => p.key === "watch")).toBe(false);
  });

  it("одиночный виджет вторым не заводится, статья чужому виду не ставится", () => {
    expect(addWidget(DEFAULT_LAYOUT, "month")).toEqual(DEFAULT_LAYOUT);
    const layout = setWidgetCategory(DEFAULT_LAYOUT, "month", "Еда");
    expect(layout.find((p) => p.key === "month")).not.toHaveProperty("category");
  });

  it("доходная категория помнит, что она доходная", () => {
    let layout = setWidgetCategory(addWidget(DEFAULT_LAYOUT, "watch"), "watch", "Зарплата", "", true);
    expect(layout.find((p) => p.key === "watch")).toEqual({
      key: "watch",
      kind: "watch",
      category: "Зарплата",
      income: true,
    });
    expect(normalizeLayout(JSON.parse(JSON.stringify(layout))).find((p) => p.key === "watch")).toMatchObject({
      income: true,
    });
    // Сменили на расходную — признак снимается.
    layout = setWidgetCategory(layout, "watch", "Еда");
    expect(layout.find((p) => p.key === "watch")).not.toHaveProperty("income");
  });

  it("«Тег под наблюдением»: тег хранится вместе с режимом", () => {
    expect(DEFAULT_LAYOUT.some((p) => p.kind === "watchTag")).toBe(false);
    let layout = addWidget(addWidget(DEFAULT_LAYOUT, "watchTag"), "watchTag");
    layout = setWidgetTag(layout, "watchTag", "отпуск");
    layout = setWidgetTag(layout, "watchTag-2", "Отпуск", "categories");
    const back = normalizeLayout(JSON.parse(JSON.stringify(layout)));
    expect(back.find((p) => p.key === "watchTag")).toEqual({
      key: "watchTag",
      kind: "watchTag",
      tag: "отпуск",
      tagMode: "hashtags",
    });
    expect(back.find((p) => p.key === "watchTag-2")).toMatchObject({ tag: "Отпуск", tagMode: "categories" });
    // Тег чужому виду не ставится, пустой — снимает выбор.
    expect(setWidgetTag(layout, "month", "x").find((p) => p.key === "month")).not.toHaveProperty("tag");
    expect(setWidgetTag(layout, "watchTag", "").find((p) => p.key === "watchTag")).toEqual({
      key: "watchTag",
      kind: "watchTag",
    });
  });

  it("пустая категория снимает выбор", () => {
    let layout = setWidgetCategory(addWidget(DEFAULT_LAYOUT, "watch"), "watch", "Еда", "Кафе");
    layout = setWidgetCategory(layout, "watch", "");
    expect(layout.find((p) => p.key === "watch")).toEqual({ key: "watch", kind: "watch" });
  });
});
