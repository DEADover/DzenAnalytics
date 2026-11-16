import { describe, it, expect } from "vitest";
import { parseTextQuery } from "./textQuery";

const hit = (q: string, text: string, comment = "") => parseTextQuery(q).test(`${text} ${comment}`, comment);

describe("parseTextQuery (#135)", () => {
  it("обычный текст ищется фразой, как раньше", () => {
    expect(hit("кофе на вынос", "Кофе на вынос у дома")).toBe(true);
    expect(hit("кофе вынос", "Кофе на вынос")).toBe(false);
    expect(hit("rjat", "Кофе")).toBe(true); // другая раскладка
    expect(parseTextQuery("   ").empty).toBe(true);
  });

  it("дефис внутри слова — не условие", () => {
    expect(hit("т-банк", "Т-Банк")).toBe(true);
  });

  it("-слово: не содержит", () => {
    expect(hit("-возврат", "Магазин", "Возврат долга")).toBe(false);
    expect(hit("-возврат", "Магазин", "подарок")).toBe(true);
    expect(hit("магазин -возврат", "Магазин", "подарок")).toBe(true);
    expect(hit("магазин -возврат", "Кафе", "подарок")).toBe(false);
    expect(hit('-"на вынос"', "Кофе на вынос")).toBe(false);
    expect(hit('-"на вынос"', "Кофе на месте")).toBe(true);
  });

  it("недописанное условие ничего не прячет", () => {
    expect(hit("-", "Т-Банк - карта")).toBe(true);
    expect(hit("комм:", "Кафе")).toBe(true);
  });

  it("комм: ищет только в комментарии", () => {
    expect(hit("комм:кофе", "Кофейня", "")).toBe(false);
    expect(hit("комм:кофе", "Магазин", "Купил кофе")).toBe(true);
    expect(hit("-комм:кофе", "Кофейня", "")).toBe(true);
    expect(hit("-комм:кофе", "Магазин", "Купил кофе")).toBe(false);
    expect(hit("Комментарий:кофе", "Магазин", "Купил кофе")).toBe(true);
  });

  it("комм:пусто и комм:есть", () => {
    expect(hit("комм:пусто", "Магазин", "")).toBe(true);
    expect(hit("комм:пусто", "Магазин", "  ")).toBe(true);
    expect(hit("комм:пусто", "Магазин", "что-то")).toBe(false);
    expect(hit("комм:есть", "Магазин", "что-то")).toBe(true);
    expect(hit("комм:есть", "Магазин", "")).toBe(false);
    expect(hit("-комм:пусто", "Магазин", "")).toBe(false);
    expect(hit("магазин комм:пусто", "Кафе", "")).toBe(false);
  });
});
