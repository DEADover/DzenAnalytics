import { describe, expect, it } from "vitest";
import {
  DEFAULT_HEADER_NAV,
  OVERFLOW_GROUP_TITLE,
  PRIMARY_GROUP_TITLE,
  fitCount,
  isDefaultHeaderNav,
  moreGroups,
  moveItem,
  normalizeHeaderNav,
} from "./headerNav";
import { ALL_SECTIONS, SECONDARY } from "./navSections";

describe("основное меню", () => {
  it("по умолчанию — прежние четыре основных раздела", () => {
    expect(normalizeHeaderNav(undefined)).toEqual(["/", "/transactions", "/accounts", "/categories"]);
    expect(isDefaultHeaderNav(normalizeHeaderNav(null))).toBe(true);
  });

  it("сохранённое чистится: чужие пути, повторы и не строки выпадают, порядок сохраняется", () => {
    expect(normalizeHeaderNav(["/budgets", "/nope", "/", 42, "/budgets", "/trash"])).toEqual(["/budgets", "/", "/trash"]);
  });

  it("пустой список — законный выбор: всё в «Ещё»", () => {
    expect(normalizeHeaderNav([])).toEqual([]);
    const groups = moreGroups([]);
    expect(groups[0].title).toBe(PRIMARY_GROUP_TITLE);
    expect(groups.flatMap((g) => g.items)).toHaveLength(ALL_SECTIONS.length);
  });

  it("в «Ещё» нет того, что стоит в шапке; при умолчании группы — прежние", () => {
    const groups = moreGroups(DEFAULT_HEADER_NAV);
    expect(groups.map((g) => g.title)).toEqual(["Аналитика", "Планы", "Инструменты"]);
    expect(groups.flatMap((g) => g.items)).toHaveLength(SECONDARY.length);

    const custom = moreGroups(["/", "/budgets"]);
    const paths = custom.flatMap((g) => g.items.map((s) => s.to));
    expect(paths).not.toContain("/");
    expect(paths).not.toContain("/budgets");
    expect(paths).toContain("/transactions");
    expect(custom[0].title).toBe(PRIMARY_GROUP_TITLE);
  });

  it("не поместившиеся в шапку — первой группой «Ещё»", () => {
    const groups = moreGroups(["/", "/transactions", "/budgets"], ["/budgets"]);
    expect(groups[0]).toMatchObject({ title: OVERFLOW_GROUP_TITLE });
    expect(groups[0].items.map((s) => s.to)).toEqual(["/budgets"]);
    // В своей обычной группе не повторяется.
    expect(groups.slice(1).flatMap((g) => g.items.map((s) => s.to))).not.toContain("/budgets");
  });

  it("fitCount: пункты подряд, пока влезают, с промежутками", () => {
    // fixed 100, промежуток 2: 100+2+80=182, +2+90=274, +2+60=336 > 300.
    expect(fitCount([80, 90, 60], 300, 100, 2)).toBe(2);
    expect(fitCount([80, 90, 60], 1000, 100, 2)).toBe(3);
    expect(fitCount([80], 150, 100, 2)).toBe(0);
    // Короткий пункт после не влезшего место не занимает.
    expect(fitCount([80, 500, 10], 300, 100, 2)).toBe(1);
  });

  it("moveItem: соседняя перестановка и края", () => {
    expect(moveItem(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(moveItem(["a", "b", "c"], "x", 1)).toEqual(["a", "b", "c"]);
  });
});
