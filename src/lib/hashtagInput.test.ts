import { describe, expect, it } from "vitest";
import { hashFragment, insertHashtag, matchHashtags } from "./hashtagInput";

describe("hashFragment", () => {
  it("видит тег под кареткой", () => {
    expect(hashFragment("#", 1)).toEqual({ start: 0, query: "" });
    expect(hashFragment("кафе #от", 8)).toEqual({ start: 5, query: "от" });
    expect(hashFragment("-#от", 4)).toEqual({ start: 1, query: "от" });
  });

  it("после пробела тег закончен", () => {
    expect(hashFragment("#отпуск кафе", 12)).toBeNull();
    expect(hashFragment("без решётки", 5)).toBeNull();
  });

  it("смотрит на текст до каретки", () => {
    expect(hashFragment("#отпуск кафе", 4)).toEqual({ start: 0, query: "отп" });
  });
});

describe("matchHashtags", () => {
  const tags = ["Отпуск", "Ремонт", "Отдых"];
  it("пустой запрос — все", () => {
    expect(matchHashtags(tags, "")).toEqual(tags);
  });
  it("по началу, без регистра", () => {
    expect(matchHashtags(tags, "от")).toEqual(["Отпуск", "Отдых"]);
  });
  it("набрано в другой раскладке", () => {
    expect(matchHashtags(tags, "jng")).toEqual(["Отпуск"]);
  });
  it("соблюдает предел", () => {
    expect(matchHashtags(tags, "", 1)).toHaveLength(1);
  });
});

describe("insertHashtag", () => {
  it("заменяет фрагмент и ставит пробел", () => {
    expect(insertHashtag("кафе #от", { start: 5, query: "от" }, "Отпуск")).toEqual({
      next: "кафе #Отпуск ",
      caret: 13,
    });
  });
  it("не удваивает пробел перед продолжением", () => {
    expect(insertHashtag("#от кафе", { start: 0, query: "от" }, "Отпуск").next).toBe("#Отпуск кафе");
  });
});
