import { describe, it, expect } from "vitest";
import {
  alignOf,
  buildCsv,
  cellClass,
  compareValues,
  csvEscape,
  csvFileName,
  headClass,
  nextSort,
  scaledWidth,
  sortRows,
  toneOfSigned,
} from "./tableKit";

describe("тип колонки → выравнивание", () => {
  it("текст и дата влево, числа вправо, метки и действия по центру", () => {
    expect(alignOf("text")).toBe("left");
    expect(alignOf("date")).toBe("left");
    expect(alignOf("money")).toBe("right");
    expect(alignOf("main")).toBe("right");
    expect(alignOf("balance")).toBe("left");
    expect(alignOf("number")).toBe("right");
    expect(alignOf("pct")).toBe("left");
    expect(alignOf("change")).toBe("right");
    expect(alignOf("count")).toBe("right");
    expect(alignOf("mark")).toBe("center");
    expect(alignOf("actions")).toBe("center");
  });

  it("шапка выравнивается так же, как значения", () => {
    expect(headClass("money")).toContain("text-right");
    expect(headClass("count")).toContain("text-right");
    expect(headClass("money")).toContain("text-right");
    expect(headClass("text")).toContain("text-left");
  });
});

describe("цвет ячейки", () => {
  it("цвет стороны получает только главная сумма", () => {
    expect(cellClass("main", { tone: "expense" })).toContain("text-expense");
    expect(cellClass("money", { tone: "expense" })).not.toContain("text-expense");
    expect(cellClass("pct", { tone: "income" })).not.toContain("text-income");
  });

  it("метка может быть цветной, нейтральный тон цвета не даёт", () => {
    expect(cellClass("mark", { tone: "warn" })).toContain("text-warn");
    expect(cellClass("main", { tone: "neutral" })).not.toMatch(/text-(expense|income|warn)/);
  });

  it("остаток — главная колонка «Капитала»: 500, влево, минус красным", () => {
    const cls = cellClass("balance", { tone: "expense" });
    expect(cls).toContain("text-left");
    expect(cls).toContain("font-medium");
    expect(cls).toContain("text-expense");
    expect(cellClass("balance", { tone: "neutral" })).not.toMatch(/text-(expense|income|warn)/);
  });

  it("главная сумма — 500, числа — табличными цифрами", () => {
    expect(cellClass("main")).toContain("font-medium");
    expect(cellClass("money")).toContain("tabular-nums");
    expect(cellClass("count")).toContain("tabular-nums");
  });

  it("знак суммы задаёт сторону", () => {
    expect(toneOfSigned(-1)).toBe("expense");
    expect(toneOfSigned(0)).toBe("income");
    expect(toneOfSigned(5)).toBe("income");
  });
});

describe("сортировка", () => {
  it("первый клик: числа и даты — по убыванию, текст — по возрастанию", () => {
    expect(nextSort({ key: undefined, dir: "asc" }, "sum", "money")).toEqual({ key: "sum", dir: "desc" });
    expect(nextSort({ key: "sum", dir: "desc" }, "date", "date")).toEqual({ key: "date", dir: "desc" });
    expect(nextSort({ key: "sum", dir: "desc" }, "name", "text")).toEqual({ key: "name", dir: "asc" });
  });

  it("повторный клик разворачивает направление", () => {
    expect(nextSort({ key: "sum", dir: "desc" }, "sum", "money")).toEqual({ key: "sum", dir: "asc" });
    expect(nextSort({ key: "name", dir: "asc" }, "name", "text")).toEqual({ key: "name", dir: "desc" });
  });

  it("пустые значения внизу при любом направлении", () => {
    const rows = [{ v: 2 }, { v: null }, { v: 5 }, { v: undefined }, { v: 1 }];
    expect(sortRows(rows, (r) => r.v, "desc").map((r) => r.v)).toEqual([5, 2, 1, null, undefined]);
    expect(sortRows(rows, (r) => r.v, "asc").map((r) => r.v)).toEqual([1, 2, 5, null, undefined]);
  });

  it("строки — по-русски и с числами внутри по значению", () => {
    const rows = ["Яблоко", "арбуз", "Ёжик", "Счёт 10", "Счёт 2"];
    expect(sortRows(rows, (r) => r, "asc")).toEqual(["арбуз", "Ёжик", "Счёт 2", "Счёт 10", "Яблоко"]);
  });

  it("устойчива: равные строки не меняются местами", () => {
    const rows = [
      { id: "a", v: 1 },
      { id: "b", v: 1 },
      { id: "c", v: 1 },
    ];
    expect(sortRows(rows, (r) => r.v, "desc").map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("сравнение чисел не строковое", () => {
    expect(compareValues(10, 9, "asc")).toBeGreaterThan(0);
    expect(compareValues(10, 9, "desc")).toBeLessThan(0);
  });
});

describe("выгрузка CSV", () => {
  it("экранирует разделитель, кавычки и переносы", () => {
    expect(csvEscape("a;b")).toBe('"a;b"');
    expect(csvEscape('Кафе "Ромашка"')).toBe('"Кафе ""Ромашка"""');
    expect(csvEscape("строка\nвторая")).toBe('"строка\nвторая"');
  });

  it("обезвреживает формулы, но не трогает обычные числа", () => {
    expect(csvEscape("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvEscape("+7 999 000")).toBe("'+7 999 000");
    expect(csvEscape("-cmd")).toBe("'-cmd");
    expect(csvEscape(-100)).toBe("-100");
    expect(csvEscape("-2450.50")).toBe("-2450.50");
  });

  it("пустое значение — пустая ячейка", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
  });

  it("собирает шапку и строки через «;»", () => {
    expect(buildCsv(["Дата", "Сумма"], [["2026-05-01", 100], ["2026-05-02", 250.5]])).toBe(
      "Дата;Сумма\n2026-05-01;100\n2026-05-02;250.5"
    );
  });

  it("имя файла без пробелов и спецсимволов", () => {
    expect(csvFileName("Топ категорий / расходы", new Date("2026-09-14T10:00:00Z"))).toBe(
      "dzenanalytics_топ_категорий_расходы_2026-09-14.csv"
    );
    expect(csvFileName(undefined, new Date("2026-09-14T10:00:00Z"))).toBe("dzenanalytics_table_2026-09-14.csv");
  });
});

describe("ширина колонки", () => {
  it("растёт вместе с размером текста таблиц", () => {
    expect(scaledWidth("6.5rem")).toBe("calc(6.5rem * var(--tbl-scale, 1))");
    expect(scaledWidth("120px")).toBe("calc(120px * var(--tbl-scale, 1))");
  });

  it("доли таблицы и auto не трогает, пустая ширина — без стиля", () => {
    expect(scaledWidth("12%")).toBe("12%");
    expect(scaledWidth("auto")).toBe("auto");
    expect(scaledWidth(undefined)).toBeUndefined();
    expect(scaledWidth("")).toBeUndefined();
  });
});
