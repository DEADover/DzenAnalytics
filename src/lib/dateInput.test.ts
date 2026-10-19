import { describe, it, expect } from "vitest";
import { applyDateMaskKey, parseTypedDate } from "./dateInput";

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
    // Сценарий из задачи: курсор после «15», набрали «18».
    expect(type("15.10.2026", 2, [..."18"]).text).toBe("15.18.2026");
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
