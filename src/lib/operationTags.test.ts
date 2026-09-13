import { describe, it, expect } from "vitest";
import { categoryKeysOf, hasCategory, tagLabel, tagsOf } from "./operationTags";

const op = (p: { categoryFull?: string; extraCategories?: string[]; comment?: string }) => ({
  categoryFull: p.categoryFull ?? "Еда",
  extraCategories: p.extraCategories,
  comment: p.comment ?? "",
});

describe("categoryKeysOf", () => {
  it("основная первой, вторые следом", () => {
    expect(categoryKeysOf(op({ extraCategories: ["Отпуск", "Путешествия / Италия"] }))).toEqual([
      "Еда",
      "Отпуск",
      "Путешествия / Италия",
    ]);
  });

  it("у операции с одной категорией — только она", () => {
    expect(categoryKeysOf(op({}))).toEqual(["Еда"]);
  });
});

describe("hasCategory", () => {
  it("находит операцию и по второй категории", () => {
    // Пункт 1 задачи: «Отпуск» всегда второй — и в фильтре его не было.
    expect(hasCategory(op({ extraCategories: ["Отпуск"] }), "Отпуск")).toBe(true);
  });

  it("по основной — как раньше", () => {
    expect(hasCategory(op({}), "Еда")).toBe(true);
  });

  it("подкатегория не тянет за собой родителя", () => {
    expect(hasCategory(op({ extraCategories: ["Путешествия / Италия"] }), "Путешествия")).toBe(false);
  });
});

describe("tagsOf", () => {
  const t = op({ comment: "Ужин #отпуск #семья", extraCategories: ["Отпуск"] });

  it("в режиме хэштегов — слова с решёткой из комментария", () => {
    expect(tagsOf(t, "hashtags")).toEqual(["отпуск", "семья"]);
  });

  it("в режиме категорий — вторые категории, комментарий не читается", () => {
    expect(tagsOf(t, "categories")).toEqual(["Отпуск"]);
  });

  it("без вторых категорий тегов нет", () => {
    expect(tagsOf(op({ comment: "#отпуск" }), "categories")).toEqual([]);
  });
});

describe("tagLabel", () => {
  it("хэштег — с решёткой, категория — без", () => {
    expect(tagLabel("отпуск", "hashtags")).toBe("#отпуск");
    expect(tagLabel("Путешествия / Отпуск", "categories")).toBe("Путешествия / Отпуск");
  });
});
