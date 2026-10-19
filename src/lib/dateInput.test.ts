import { describe, it, expect } from "vitest";
import { applyDateMaskKey, isPlausibleDatePrefix, parseTypedDate } from "./dateInput";

const today = "2026-09-30";
const p = (s: string) => parseTypedDate(s, today);

describe("parseTypedDate", () => {
  it("привычные записи с разделителями", () => {
    expect(p("28.03.2026")).toBe("2026-03-28");
    expect(p("28.3.26")).toBe("2026-03-28");
    expect(p("28/03/2026")).toBe("2026-03-28");
    expect(p("28-03-2026")).toBe("2026-03-28");
    expect(p("2026-03-28")).toBe("2026-03-28");
  });

  it("одни цифры: быстрый ввод", () => {
    expect(p("280326")).toBe("2026-03-28");
    expect(p("28032026")).toBe("2026-03-28");
    expect(p("2803")).toBe("2026-03-28");
    expect(p("5")).toBe("2026-09-05");
  });

  it("без года — этот год", () => {
    expect(p("28.03")).toBe("2026-03-28");
  });

  it("слова", () => {
    expect(p("сегодня")).toBe("2026-09-30");
    expect(p("вч")).toBe("2026-09-29");
    expect(p("завтра")).toBe("2026-10-01");
  });

  it("несуществующая дата и мусор — null, а не перенос", () => {
    expect(p("31.02.2026")).toBeNull();
    expect(p("32")).toBeNull();
    expect(p("12345")).toBeNull();
    expect(p("abc")).toBeNull();
    expect(p("")).toBeNull();
  });
});

describe("applyDateMaskKey (#125)", () => {
  /** Набрать строку клавишами, начиная с текста и курсора. */
  const type = (text: string, caret: number, keys: string[]) => {
    let t = text;
    let c = caret;
    let sel = caret;
    for (const k of keys) {
      const r = applyDateMaskKey(t, c, sel, k);
      if (!r) throw new Error(`маска не обработала «${k}» в «${t}»`);
      t = r.text;
      c = sel = r.caret;
    }
    return { text: t, caret: c };
  };

  it("с нуля: точки встают сами", () => {
    expect(type("", 0, [..."18102026"]).text).toBe("18.10.2026");
    expect(type("", 0, [..."18"]).text).toBe("18.");
    expect(type("", 0, [..."1810"]).text).toBe("18.10.");
  });

  it("лишние цифры в конце не дописываются", () => {
    expect(type("18.10.2026", 10, ["5"]).text).toBe("18.10.2026");
  });

  it("цифра заменяет цифру под курсором, а не вставляется", () => {
    // Сценарий из задачи: курсор после «15» — правится месяц, а не
    // раздвигается день («1518.10.2026»).
    expect(type("15.10.2026", 2, [..."12"]).text).toBe("15.12.2026");
    // Курсор в начале — меняется день.
    const r = type("15.10.2026", 0, [..."18"]);
    expect(r.text).toBe("18.10.2026");
    expect(r.caret).toBe(3);
  });

  it("всё выделено — набор с нуля", () => {
    expect(applyDateMaskKey("15.10.2026", 0, 10, "1")).toEqual({ text: "1", caret: 1 });
  });

  it("точка после одной цифры дописывает ноль", () => {
    expect(type("", 0, ["5", "."]).text).toBe("05.");
    expect(type("", 0, ["5", ",", "3", "."]).text).toBe("05.03.");
    expect(type("", 0, ["."]).text).toBe("");
  });

  it("Backspace за автоматической точкой стирает и цифру", () => {
    expect(applyDateMaskKey("18.", 3, 3, "Backspace")).toEqual({ text: "1", caret: 1 });
    expect(applyDateMaskKey("18.1", 4, 4, "Backspace")).toBeNull();
  });

  it("слова маска не трогает", () => {
    expect(applyDateMaskKey("вч", 2, 2, "е")).toBeNull();
    expect(applyDateMaskKey("вч", 2, 2, "1")).toBeNull();
  });

  it("набранное по маске разбирается", () => {
    expect(p("18.")).toBe("2026-09-18");
    expect(p("18.10.")).toBe("2026-10-18");
  });
});

describe("проверки маски даты", () => {
  const type = (keys: string, text = "") => {
    let t = text;
    let c = text.length;
    for (const k of keys) {
      const r = applyDateMaskKey(t, c, c, k);
      if (!r) throw new Error(`маска не обработала «${k}»`);
      t = r.text;
      c = r.caret;
    }
    return t;
  };

  it("день: больше 31 не набрать, «00» тоже", () => {
    expect(type("32")).toBe("3");
    expect(type("39")).toBe("3");
    expect(type("31")).toBe("31.");
    expect(type("00")).toBe("0");
    expect(type("01")).toBe("01.");
  });

  it("цифра 4–9 в начале дня — сразу «0X.»", () => {
    expect(type("5")).toBe("05.");
    expect(type("9")).toBe("09.");
  });

  it("месяц: больше 12 и «00» не набрать; 2–9 в начале — «0X.»", () => {
    expect(type("1513")).toBe("15.1");
    expect(type("1500")).toBe("15.0");
    expect(type("153")).toBe("15.03.");
    expect(type("1512")).toBe("15.12.");
  });

  it("день сверяется с месяцем", () => {
    expect(type("3104")).toBe("31.0");
    expect(type("3002")).toBe("30.0");
    expect(type("3103")).toBe("31.03.");
    expect(type("2902")).toBe("29.02.");
  });

  it("29 февраля — только в високосный год", () => {
    expect(type("29022024")).toBe("29.02.2024");
    expect(type("29022025")).toBe("29.02.202");
    expect(type("290225")).toBe("29.02.2");
    expect(type("290224")).toBe("29.02.24");
  });

  it("год — 2000-е: две цифры или четыре с «20»", () => {
    expect(type("15102026")).toBe("15.10.2026");
    expect(type("151026")).toBe("15.10.26");
    expect(type("15103")).toBe("15.10.");
    expect(type("1510199")).toBe("15.10.19");
    expect(type("15102126")).toBe("15.10.21");
  });

  it("точка после цифры не пропускает невозможное", () => {
    expect(type("0.")).toBe("0");
    expect(type("3.")).toBe("03.");
  });

  it("правка в середине: первая цифра части обнуляет вторую, если иначе нельзя", () => {
    const r = applyDateMaskKey("15.10.2026", 0, 0, "3");
    expect(r).toEqual({ text: "30.10.2026", caret: 1 });
    // «31.04» не бывает — замена не встаёт.
    expect(applyDateMaskKey("30.04.2026", 1, 1, "1")).toEqual({ text: "30.04.2026", caret: 1 });
    // Вторая цифра месяца: «10» → «13» нельзя, обнулять там нечего.
    expect(applyDateMaskKey("15.10.2026", 4, 4, "3")).toEqual({ text: "15.10.2026", caret: 4 });
  });

  it("isPlausibleDatePrefix", () => {
    expect(isPlausibleDatePrefix("")).toBe(true);
    expect(isPlausibleDatePrefix("31.12.2026")).toBe(true);
    expect(isPlausibleDatePrefix("31.11")).toBe(false);
    expect(isPlausibleDatePrefix("29.02.2100")).toBe(false);
  });
});
