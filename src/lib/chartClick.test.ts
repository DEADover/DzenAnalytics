import { describe, it, expect } from "vitest";
import { clickedRow, clickedDataKey } from "./chartClick";

const data = [{ ym: "2026-01" }, { ym: "2026-02" }, { ym: "2026-03" }];

describe("clickedRow", () => {
  it("строка по номеру точки — числом или строкой, как отдаёт Recharts 3", () => {
    expect(clickedRow({ activeIndex: "1" }, data)?.ym).toBe("2026-02");
    expect(clickedRow({ activeTooltipIndex: 2 }, data)?.ym).toBe("2026-03");
  });

  it("мимо данных — ничего", () => {
    expect(clickedRow({ activeIndex: null }, data)).toBeUndefined();
    expect(clickedRow({ activeIndex: "7" }, data)).toBeUndefined();
    expect(clickedRow(undefined, data)).toBeUndefined();
  });
});

describe("clickedDataKey", () => {
  it("строковый ключ серии или ничего", () => {
    expect(clickedDataKey({ activeDataKey: "Кафе" })).toBe("Кафе");
    expect(clickedDataKey({ activeDataKey: undefined })).toBeUndefined();
  });
});
