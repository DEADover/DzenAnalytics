import { describe, expect, it } from "vitest";
import {
  gridTemplateWith,
  hasWidthsFor,
  liveVarName,
  nextWidth,
  pickFlexIndex,
  pxToRem,
  remWidth,
  resizeTarget,
} from "./columnResize";

describe("pickFlexIndex", () => {
  it("берёт колонку, которая и так забирает всю ширину", () => {
    expect(
      pickFlexIndex([
        { key: "a", type: "text" },
        { key: "b", type: "text", width: "100%" },
      ])
    ).toBe(1);
  });

  it("иначе — первую текстовую без ширины", () => {
    expect(
      pickFlexIndex([
        { key: "date", type: "date" },
        { key: "name", type: "text" },
        { key: "sum", type: "money", width: "8rem" },
      ])
    ).toBe(1);
  });

  it("кнопки действий резиновыми не бывают", () => {
    expect(
      pickFlexIndex([
        { key: "actions", type: "actions" },
        { key: "sum", type: "money" },
      ])
    ).toBe(1);
  });

  it("у всех колонок ширина — первая текстовая", () => {
    expect(
      pickFlexIndex([
        { key: "sum", type: "money", width: "8rem" },
        { key: "name", type: "text", width: "10rem" },
      ])
    ).toBe(1);
  });
});

describe("resizeTarget", () => {
  it("левее резиновой граница меняет колонку слева", () => {
    expect(resizeTarget(0, 2)).toEqual({ index: 0, sign: 1 });
    expect(resizeTarget(1, 2)).toEqual({ index: 1, sign: 1 });
  });

  it("правее — колонку справа, и она растёт, когда граница идёт влево", () => {
    expect(resizeTarget(2, 2)).toEqual({ index: 3, sign: -1 });
    expect(resizeTarget(0, 0)).toEqual({ index: 1, sign: -1 });
  });
});

describe("nextWidth", () => {
  const base = { start: 100, min: 60, flexWidth: 300, flexMin: 80 };

  it("идёт за мышью", () => {
    expect(nextWidth({ ...base, delta: 30, sign: 1 })).toBe(130);
    expect(nextWidth({ ...base, delta: 30, sign: -1 })).toBe(70);
  });

  it("не уже подписи", () => {
    expect(nextWidth({ ...base, delta: -500, sign: 1 })).toBe(60);
  });

  it("не шире, чем может отдать резиновая колонка", () => {
    expect(nextWidth({ ...base, delta: 1000, sign: 1 })).toBe(100 + 220);
  });

  it("резиновая уже у своего минимума — колонка может только сужаться", () => {
    expect(nextWidth({ ...base, flexWidth: 70, delta: 50, sign: 1 })).toBe(100);
    expect(nextWidth({ ...base, flexWidth: 70, delta: -20, sign: 1 })).toBe(80);
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

describe("gridTemplateWith", () => {
  const tracks = [
    { key: "select", size: "20px" },
    { key: "date", size: "84px" },
    { key: "comment", size: "minmax(0, 2.6fr)" },
    { key: "amount", size: "140px" },
  ];

  it("без своих ширин — шаблон как был", () => {
    expect(gridTemplateWith(tracks, undefined, "comment")).toBe("20px 84px minmax(0, 2.6fr) 140px");
  });

  it("свои ширины сжимаются на узком окне, резиновая остаётся", () => {
    expect(gridTemplateWith(tracks, { date: 6, comment: 99, amount: 10 }, "comment")).toBe(
      "20px minmax(0, calc(6rem * var(--tbl-scale, 1))) minmax(0, 2.6fr) minmax(0, calc(10rem * var(--tbl-scale, 1)))"
    );
  });
});

describe("liveVarName", () => {
  it("годное имя CSS-переменной", () => {
    expect(liveVarName("deleted-cloud")).toBe("--cols-deleted-cloud");
    expect(liveVarName("/top#name,value")).toBe("--cols-_top_name_value");
  });
});
