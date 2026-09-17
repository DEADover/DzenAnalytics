import { describe, expect, it } from "vitest";
import {
  ICON_WIDTH_STEPS,
  iconButtonWidth,
  normalizeIconWidth,
  DEFAULT_HEADER_NAV,
  PRIMARY_GROUP_TITLE,
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

  it("moveItem: соседняя перестановка и края", () => {
    expect(moveItem(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(moveItem(["a", "b", "c"], "x", 1)).toEqual(["a", "b", "c"]);
  });

  it("ширина кнопок-значков: 0 — стандартная, дальше по 4 px до 76", () => {
    expect(iconButtonWidth(0)).toBeNull();
    expect(iconButtonWidth(1)).toBe(40);
    expect(iconButtonWidth(ICON_WIDTH_STEPS)).toBe(76);
    // Мусор из сохранения или с другого устройства — стандартная ширина.
    for (const bad of [-1, 11, 2.5, "3", null, undefined]) expect(normalizeIconWidth(bad)).toBe(0);
    expect(iconButtonWidth(99)).toBeNull();
  });
});
