import { describe, it, expect } from "vitest";
import { queryMatcher, swapLayout, textMatches } from "./keyboardLayout";

describe("swapLayout", () => {
  it("латиница ↔ кириллица по клавишам", () => {
    expect(swapLayout("ghjl")).toBe("прод");
    expect(swapLayout("ьфп")).toBe("mag");
    expect(swapLayout("rfat")).toBe("кафе");
  });
});

describe("textMatches", () => {
  it("находит и в своей раскладке, и в чужой", () => {
    expect(textMatches("Продукты", "прод")).toBe(true);
    expect(textMatches("Продукты", "ghjl")).toBe(true);
    expect(textMatches("Magnit", "ьфп")).toBe(true);
    expect(textMatches("Продукты", "кафе")).toBe(false);
  });

  it("регистр и «ё» не важны", () => {
    expect(textMatches("Ёлочка", "елоч")).toBe(true);
    expect(textMatches("елочка", "ЁЛ")).toBe(true);
  });

  it("пустой запрос подходит всему", () => {
    expect(textMatches("что угодно", "  ")).toBe(true);
  });
});

describe("queryMatcher", () => {
  it("тот же ответ, что textMatches", () => {
    const m = queryMatcher("ghjl");
    expect(m("Продукты")).toBe(true);
    expect(m("Кафе")).toBe(false);
    expect(queryMatcher("")("что угодно")).toBe(true);
  });
});
