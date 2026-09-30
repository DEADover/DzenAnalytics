import { describe, expect, it } from "vitest";
import {
  clampWidth,
  gridTemplateWith,
  hasWidthsFor,
  liveVarName,
  pxToRem,
  remWidth,
  tableWidthOf,
} from "./columnResize";

describe("clampWidth", () => {
  it("идёт за мышью", () => {
    expect(clampWidth(100, 30, 60)).toBe(130);
    expect(clampWidth(100, -30, 60)).toBe(70);
  });

  it("не уже подписи", () => {
    expect(clampWidth(100, -500, 60)).toBe(60);
  });
});

describe("единицы", () => {
  it("пиксели в rem при обычном размере текста", () => {
    expect(pxToRem(160, 16, 1)).toBe(10);
    // Текст крупнее: те же 160 px — это меньше «обычных» rem.
    expect(pxToRem(160, 16, 16 / 14)).toBe(8.75);
  });

  it("ширина растёт с размером текста", () => {
    expect(remWidth(8.75)).toBe("calc(8.75rem * var(--tbl-scale, 1))");
  });
});

describe("hasWidthsFor", () => {
  it("старые ширины без общих колонок не применяются", () => {
    expect(hasWidthsFor({ old: 5 }, ["a", "b"])).toBe(false);
    expect(hasWidthsFor({ a: 5 }, ["a", "b"])).toBe(true);
    expect(hasWidthsFor(undefined, ["a"])).toBe(false);
  });
});

describe("tableWidthOf", () => {
  it("сумма своих ширин и ширин по умолчанию", () => {
    expect(
      tableWidthOf(
        [
          { key: "name" },
          { key: "sum", fallback: "calc(8rem * var(--tbl-scale, 1))" },
          { key: "actions", fallback: "calc(6rem * var(--tbl-scale, 1))" },
        ],
        { name: 20, sum: 10 },
        ["2.5rem"]
      )
    ).toBe("calc(30rem * var(--tbl-scale, 1) + 2.5rem + calc(6rem * var(--tbl-scale, 1)))");
  });

  it("у колонки нет ни своей ширины, ни ширины по умолчанию — суммы нет", () => {
    expect(tableWidthOf([{ key: "name" }, { key: "sum" }], { sum: 10 })).toBeNull();
  });
});

describe("gridTemplateWith", () => {
  const tracks = [
    { key: "select", size: "20px" },
    { key: "date", size: "84px" },
    { key: "comment", size: "minmax(0, 2.6fr)" },
    { key: "amount", size: "140px" },
  ];

  it("без своих ширин — шаблон как был", () => {
    expect(gridTemplateWith(tracks, undefined)).toBe("20px 84px minmax(0, 2.6fr) 140px");
  });

  it("свои ширины — у тех колонок, что их получили", () => {
    expect(gridTemplateWith(tracks, { date: 6, comment: 30 })).toBe(
      "20px calc(6rem * var(--tbl-scale, 1)) calc(30rem * var(--tbl-scale, 1)) 140px"
    );
  });
});

describe("liveVarName", () => {
  it("годное имя CSS-переменной", () => {
    expect(liveVarName("deleted-cloud")).toBe("--cols-deleted-cloud");
    expect(liveVarName("/top#name,value")).toBe("--cols-_top_name_value");
  });
});
