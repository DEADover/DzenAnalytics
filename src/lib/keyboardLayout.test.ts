import { describe, it, expect } from "vitest";
import { queryMatcher, swapLayout, textMatches, prefixMatcher } from "./keyboardLayout";

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

describe("prefixMatcher", () => {
  it("находит начало тега, набранное в другой раскладке", () => {
    const m = prefixMatcher("Jngecr");
    expect(m.test("Отпуск")).toBe(true);
    expect(m.test("Отпуск2026")).toBe(true);
    expect(m.test("Поездка")).toBe(false);
  });
  it("клавиши с русскими буквами на знаках: «[j,,b» — «хобби», «ёлка» без разницы с «е»", () => {
    expect(prefixMatcher("[j,,b").test("Хобби")).toBe(true);
    expect(prefixMatcher("tkrf").test("Ёлка")).toBe(true);
    expect(prefixMatcher("ьфп").test("magnit")).toBe(true);
  });
  it("прямое совпадение ранжируется выше раскладки", () => {
    const m = prefixMatcher("c");
    expect(m.rank("cafe")).toBe(0);
    expect(m.rank("сад")).toBe(1);
    expect(m.rank("дом")).toBe(-1);
  });
  it("пустой запрос подходит ко всему", () => {
    expect(prefixMatcher("").test("Любой")).toBe(true);
  });
});
