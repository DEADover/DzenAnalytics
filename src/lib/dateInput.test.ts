import { describe, it, expect } from "vitest";
import { parseTypedDate } from "./dateInput";

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
