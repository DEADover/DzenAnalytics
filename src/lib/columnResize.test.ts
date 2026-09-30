import { describe, expect, it } from "vitest";
import {
  splitWidths,
  gridTemplateWith,
  hasWidthsFor,
  liveVarName,
  pxToRem,
  remWidth,
  tableLayout,
  widthToRem,
} from "./columnResize";

describe("splitWidths", () => {
  it("граница как перегородка: левая растёт, правая сужается на столько же", () => {
    expect(splitWidths(200, 400, 80, 60, 60)).toEqual({ left: 280, right: 320, clamped: false });
    expect(splitWidths(200, 400, -50, 60, 60)).toEqual({ left: 150, right: 450, clamped: false });
  });

  it("ни одна колонка не уже своей подписи", () => {
    expect(splitWidths(200, 400, 1000, 60, 100)).toEqual({ left: 500, right: 100, clamped: true });
    expect(splitWidths(200, 400, -1000, 60, 100)).toEqual({ left: 60, right: 540, clamped: true });
  });

  it("колонка уже своей подписи — дальше не сжимается, но расшириться может", () => {
    expect(splitWidths(50, 400, -10, 60, 60)).toEqual({ left: 50, right: 400, clamped: true });
    expect(splitWidths(50, 400, 30, 60, 60)).toEqual({ left: 80, right: 370, clamped: false });
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

describe("widthToRem", () => {
  it("rem и пиксели", () => {
    expect(widthToRem("8rem")).toBe(8);
    expect(widthToRem("84px")).toBe(5.25);
    expect(widthToRem("100%")).toBeUndefined();
    expect(widthToRem(undefined)).toBeUndefined();
  });
});

describe("tableLayout", () => {
  it("колонки — доли суммы, таблица — сумма", () => {
    const l = tableLayout(
      [
        { key: "name" },
        { key: "sum", width: "8rem" },
      ],
      { name: 30 },
      ["2rem"]
    );
    expect(l).toEqual({
      total: "calc(40rem * var(--tbl-scale, 1))",
      cols: { name: "75%", sum: "20%" },
      lead: ["5%"],
    });
  });

  it("у колонки нет ни своей ширины, ни ширины по умолчанию — раскладки нет", () => {
    expect(tableLayout([{ key: "name" }, { key: "sum" }], { sum: 10 })).toBeNull();
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

  it("свои ширины — доли места, остальное как было", () => {
    expect(gridTemplateWith(tracks, { date: 6, comment: 30 })).toBe(
      "20px minmax(0, 6fr) minmax(0, 30fr) 140px"
    );
  });
});

describe("liveVarName", () => {
  it("годное имя CSS-переменной", () => {
    expect(liveVarName("deleted-cloud")).toBe("--cols-deleted-cloud");
    expect(liveVarName("/top#name,value")).toBe("--cols-_top_name_value");
  });
});
