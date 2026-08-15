import { describe, it, expect } from "vitest";
import { liveCategoryNodes } from "./categoryTree";
import type { ZenTag } from "./zenmoney";

function tag(p: Partial<ZenTag> & { id: string; title: string }): ZenTag {
  return {
    parent: null,
    archive: false,
    changed: 1,
    user: 1,
    icon: null,
    picture: null,
    color: null,
    showIncome: false,
    showOutcome: true,
    budgetIncome: false,
    budgetOutcome: false,
    required: null,
    ...p,
  } as ZenTag;
}

describe("liveCategoryNodes", () => {
  it("категория со своими подкатегориями", () => {
    const nodes = liveCategoryNodes([
      tag({ id: "1", title: "Еда" }),
      tag({ id: "2", title: "Кафе", parent: "1" }),
      tag({ id: "3", title: "Продукты", parent: "1" }),
    ]);
    expect(nodes).toEqual([{ name: "Еда", subs: ["Кафе", "Продукты"] }]);
  });

  it("архивные не предлагаются — их не примет отправка", () => {
    // Ровно случай из обращения: «Госуслуги / НДФЛ» была в истории операций, а
    // в справочнике подкатегория уже в архиве.
    const nodes = liveCategoryNodes([
      tag({ id: "1", title: "Госуслуги" }),
      tag({ id: "2", title: "НДФЛ", parent: "1", archive: true }),
      tag({ id: "3", title: "Старая", archive: true }),
    ]);
    expect(nodes).toEqual([{ name: "Госуслуги", subs: [] }]);
  });

  it("подкатегория живого родителя в архиве не тянет за собой родителя", () => {
    const nodes = liveCategoryNodes([
      tag({ id: "1", title: "Еда" }),
      tag({ id: "2", title: "Кафе", parent: "1", archive: true }),
      tag({ id: "3", title: "Продукты", parent: "1" }),
    ]);
    expect(nodes).toEqual([{ name: "Еда", subs: ["Продукты"] }]);
  });

  it("живая подкатегория архивного родителя становится своей категорией", () => {
    // Иначе она пропала бы из списка, хотя отправка её находит: без
    // подкатегории тег ищется по имени.
    const nodes = liveCategoryNodes([
      tag({ id: "1", title: "Старое", archive: true }),
      tag({ id: "2", title: "Живое", parent: "1" }),
    ]);
    expect(nodes).toEqual([{ name: "Живое", subs: [] }]);
  });

  it("категории и подкатегории идут по алфавиту", () => {
    const nodes = liveCategoryNodes([
      tag({ id: "1", title: "Яхта" }),
      tag({ id: "2", title: "Аренда" }),
      tag({ id: "3", title: "Яхтклуб", parent: "1" }),
      tag({ id: "4", title: "Ангар", parent: "1" }),
    ]);
    expect(nodes.map((n) => n.name)).toEqual(["Аренда", "Яхта"]);
    expect(nodes[1].subs).toEqual(["Ангар", "Яхтклуб"]);
  });

  it("пустой справочник — пустое дерево, а не поломка", () => {
    expect(liveCategoryNodes([])).toEqual([]);
  });
});
