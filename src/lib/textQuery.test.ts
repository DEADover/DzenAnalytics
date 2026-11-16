import { describe, it, expect } from "vitest";
import { awaitsCommentValue, completeCommentPrefix, parseTextQuery, queryPieces } from "./textQuery";

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

  it("минус после «комм:» и пробел после двоеточия — как кому удобнее", () => {
    for (const q of ["комм:-завтрак", "-комм:завтрак", "комм: -завтрак", "комм:-\"завтрак\""]) {
      expect(hit(q, "Завтрак в кафе", "")).toBe(true); // слово не в комментарии
      expect(hit(q, "Кафе", "Завтрак")).toBe(false);
      expect(hit(q, "Кафе", "обед")).toBe(true);
    }
    expect(hit("комм: завтрак", "Завтрак в кафе", "")).toBe(false);
    expect(hit("комм: завтрак", "Кафе", "Завтрак")).toBe(true);
    expect(hit("комм: пусто", "Кафе", "")).toBe(true);
    expect(hit("комм: пусто", "Кафе", "обед")).toBe(false);
    // Недописанное «комм:-» ничего не прячет.
    expect(hit("комм:-", "Кафе", "обед")).toBe(true);
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

describe("подсветка и дописывание условий", () => {
  it("queryPieces: куски склеиваются обратно в запрос", () => {
    for (const q of ["аптека -комм:мама", "комм:пусто", "т-банк - карта", "-кофе  -\"на вынос\"", ""]) {
      expect(queryPieces(q).map((p) => p.text).join("")).toBe(q);
    }
    expect(queryPieces("аптека -комм:мама").filter((p) => p.op).map((p) => p.text)).toEqual(["-комм:"]);
    expect(queryPieces("-кофе комм:есть").filter((p) => p.op).map((p) => p.text)).toEqual(["-", "комм:"]);
    expect(queryPieces("т-банк - карта").some((p) => p.op)).toBe(false);
    expect(queryPieces("комм:-завтрак").filter((p) => p.op).map((p) => p.text)).toEqual(["комм:-"]);
    expect(queryPieces("комм: -завтрак").filter((p) => p.op).map((p) => p.text)).toEqual(["комм:", "-"]);
  });

  it("completeCommentPrefix: «комм» в конце превращается в «комм:»", () => {
    expect(completeCommentPrefix("комм")).toBe("комм:");
    expect(completeCommentPrefix("аптека -коммен")).toBe("аптека -комм:");
    expect(completeCommentPrefix("Комментарий")).toBe("комм:");
    expect(completeCommentPrefix("ком")).toBeNull();
    expect(completeCommentPrefix("коммуналка")).toBeNull();
    expect(completeCommentPrefix("комм ")).toBeNull();
    expect(completeCommentPrefix("комм:")).toBeNull();
    expect(completeCommentPrefix("подкомм")).toBeNull();
  });

  it("awaitsCommentValue", () => {
    expect(awaitsCommentValue("аптека -комм:")).toBe(true);
    expect(awaitsCommentValue("комм:п")).toBe(false);
  });
});
