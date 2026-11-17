import { describe, it, expect } from "vitest";
import { amountPredicate, awaitsValue, completePrefix, parseTextQuery, queryPieces, txQueryFields } from "./textQuery";

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
    expect(hit("комм: нет", "Кафе", "")).toBe(true);
    expect(hit("комм: нет", "Кафе", "обед")).toBe(false);
    // Недописанное «комм:-» ничего не прячет.
    expect(hit("комм:-", "Кафе", "обед")).toBe(true);
  });

  it("комм:нет и комм:есть", () => {
    expect(hit("комм:нет", "Магазин", "")).toBe(true);
    expect(hit("комм:нет", "Магазин", "  ")).toBe(true);
    expect(hit("комм:нет", "Магазин", "что-то")).toBe(false);
    expect(hit("комм:есть", "Магазин", "что-то")).toBe(true);
    expect(hit("комм:есть", "Магазин", "")).toBe(false);
    expect(hit("-комм:нет", "Магазин", "")).toBe(false);
    expect(hit("магазин комм:нет", "Кафе", "")).toBe(false);
  });

  it("слова «есть» и «нет» в самом комментарии ищут в кавычках", () => {
    expect(hit('комм:"нет"', "Кафе", "чека нет")).toBe(true);
    expect(hit('комм:"нет"', "Кафе", "")).toBe(false);
    expect(hit('комм:"есть"', "Кафе", "есть чек")).toBe(true);
    expect(hit('комм:"есть"', "Кафе", "обед")).toBe(false);
    expect(hit('комм:-"есть"', "Кафе", "есть чек")).toBe(false);
    // Слово длиннее служебного — уже обычный поиск.
    expect(hit("комм:нету", "Кафе", "нету")).toBe(true);
    // Прежнее «пусто» больше не служебное — это обычное слово.
    expect(hit("комм:пусто", "Кафе", "")).toBe(false);
    expect(hit("комм:пусто", "Кафе", "в холодильнике пусто")).toBe(true);
  });
});

describe("подсветка и дописывание условий", () => {
  it("queryPieces: куски склеиваются обратно в запрос", () => {
    for (const q of ["аптека -комм:мама", "комм:нет", "т-банк - карта", "-кофе  -\"на вынос\"", ""]) {
      expect(queryPieces(q).map((p) => p.text).join("")).toBe(q);
    }
    expect(queryPieces("аптека -комм:мама").filter((p) => p.op).map((p) => p.text)).toEqual(["-комм:"]);
    expect(queryPieces("-кофе комм:есть").filter((p) => p.op).map((p) => p.text)).toEqual(["-", "комм:"]);
    expect(queryPieces("т-банк - карта").some((p) => p.op)).toBe(false);
    expect(queryPieces("комм:-завтрак").filter((p) => p.op).map((p) => p.text)).toEqual(["комм:-"]);
    expect(queryPieces("комм: -завтрак").filter((p) => p.op).map((p) => p.text)).toEqual(["комм:", "-"]);
  });

  it("completePrefix: «комм» в конце превращается в «комм:»", () => {
    expect(completePrefix("комм")?.next).toBe("комм:");
    expect(completePrefix("аптека -коммен")?.next).toBe("аптека -комм:");
    expect(completePrefix("Комментарий")?.next).toBe("комм:");
    expect(completePrefix("ком")).toBeNull();
    expect(completePrefix("коммуналка")).toBeNull();
    expect(completePrefix("комм ")).toBeNull();
    expect(completePrefix("комм:")).toBeNull();
    expect(completePrefix("подкомм")).toBeNull();
  });

  it("awaitsValue", () => {
    expect(awaitsValue("аптека -комм:")).not.toBeNull();
    expect(awaitsValue("комм:п")).toBeNull();
  });
});

describe("условия по сумме, счёту и категории", () => {
  const op = txQueryFields({
    amount: -5400,
    account: "Сбер",
    outcomeAccount: "Сбер",
    incomeAccount: "",
    categoryFull: "Еда / Кафе",
    extraCategories: ["Отпуск"],
  });
  const ok = (q: string, f = op) => parseTextQuery(q).test("Кофейня у дома", "на вынос", f);

  it("сумма: больше, меньше, равно, от и до — знак операции не важен", () => {
    expect(ok("сумма:>5000")).toBe(true);
    expect(ok("сумма:>5400")).toBe(false);
    expect(ok("сумма:>=5400")).toBe(true);
    expect(ok("сумма:<5400")).toBe(false);
    expect(ok("сумма:<=5400")).toBe(true);
    expect(ok("сумма:5400")).toBe(true);
    expect(ok("сумма:=5400")).toBe(true);
    expect(ok("сумма:5000")).toBe(false);
    expect(ok("сумма:5000-6000")).toBe(true);
    expect(ok("сумма:6000..5000")).toBe(true);
    expect(ok("сумма:1-100")).toBe(false);
    expect(ok("сумма: >5000")).toBe(true);
    expect(ok("сумма:>5399,5")).toBe(true);
  });

  it("минус переворачивает условие", () => {
    expect(ok("-сумма:>5000")).toBe(false);
    expect(ok("сумма:-5400")).toBe(false);
    expect(ok("-счёт:сбер")).toBe(false);
    expect(ok("счёт:-тинь")).toBe(true);
    expect(ok("кат:-кафе")).toBe(false);
  });

  it("недописанное условие по сумме ничего не отбирает", () => {
    expect(ok("сумма:")).toBe(true);
    expect(ok("сумма:>")).toBe(true);
    expect(ok("сумма:много")).toBe(true);
    expect(amountPredicate(">")).toBeNull();
    expect(amountPredicate("5к")).toBeNull();
  });

  it("счёт и категория — по слову, в любой раскладке и с «е» вместо «ё»", () => {
    expect(ok("счёт:сбер")).toBe(true);
    expect(ok("счет:сбер")).toBe(true);
    expect(ok("счёт:тинь")).toBe(false);
    expect(ok("кат:кафе")).toBe(true);
    expect(ok("категория:еда")).toBe(true);
    expect(ok("кат:отпуск")).toBe(true); // вторая категория
    expect(ok("кат:такси")).toBe(false);
    expect(ok('кат:"еда / кафе"')).toBe(true);
  });

  it("условия сочетаются между собой и с текстом", () => {
    expect(ok("кофейня сумма:>5000 счёт:сбер кат:кафе комм:вынос")).toBe(true);
    expect(ok("кофейня сумма:>5000 счёт:тинь")).toBe(false);
    expect(ok("аптека сумма:>5000")).toBe(false);
  });

  it("у строки без нужного поля условие не выполняется", () => {
    expect(parseTextQuery("сумма:>1").test("x", "", {})).toBe(false);
    expect(parseTextQuery("счёт:сбер").test("x", "")).toBe(false);
    expect(parseTextQuery("кофе").test("кофе", "")).toBe(true);
  });

  it("у перевода счёт ищется в обеих сторонах", () => {
    const transfer = txQueryFields({ amount: 1000, account: "Сбер", outcomeAccount: "Сбер", incomeAccount: "Копилка" });
    expect(ok("счёт:копилка", transfer)).toBe(true);
    expect(ok("счёт:сбер", transfer)).toBe(true);
  });

  it("подсветка и подсказки знают новые условия", () => {
    expect(queryPieces("кофе сумма:>500 -счёт:сбер").filter((p) => p.op).map((p) => p.text)).toEqual(["сумма:", "-счёт:"]);
    expect(completePrefix("сумм")).toEqual({ next: "сумма:", label: "Искать по сумме" });
    expect(completePrefix("сум")).toBeNull();
    expect(completePrefix("сумка")).toBeNull();
    expect(completePrefix("кофе счет")).toEqual({ next: "кофе счёт:", label: "Искать по счёту" });
    expect(completePrefix("-кат")).toEqual({ next: "-кат:", label: "Искать по категории" });
    expect(completePrefix("катер")).toBeNull();
    expect(completePrefix("комм")?.label).toBe("Искать в комментарии");
    expect(awaitsValue("сумма:")).toBe(">5000, <100 или 1000-5000");
    expect(awaitsValue("кофе счёт:")).toBe("слово или -слово");
    expect(awaitsValue("комм:")).toBe("слово, -слово, есть или нет");
  });
});
