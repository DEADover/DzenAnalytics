import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { matchesQuery, nodeText } from "./nodeText";

describe("текст разметки одной строкой", () => {
  it("собирает текст из вложенных элементов", () => {
    const node = h("div", null, h("p", null, "Бюджет ", h("strong", null, "по периметру")));
    expect(nodeText(node)).toBe("Бюджет по периметру");
  });

  it("разделяет соседние узлы пробелом", () => {
    const node = h("ul", null, h("li", null, "Счета"), h("li", null, "Категории"));
    expect(nodeText(node)).toBe("Счета Категории");
  });

  it("берёт подсказку и замену картинки — их тоже читают", () => {
    const node = h("span", { title: "Свободные деньги" }, h("img", { alt: "Схема потока" }));
    expect(nodeText(node)).toContain("Свободные деньги");
    expect(nodeText(node)).toContain("Схема потока");
  });

  it("пропускает пустое: null, false и пробелы", () => {
    const node = h("div", null, null, false, "  Правила  ", undefined);
    expect(nodeText(node)).toBe("Правила");
  });

  it("числа попадают в текст", () => {
    expect(nodeText(h("span", null, "Правило ", 50, "/", 30, "/", 20))).toBe("Правило 50 / 30 / 20");
  });
});

describe("поиск по словам", () => {
  const text = "Бюджет считает факт за отчётный месяц по периметру счетов";

  it("находит по одному слову", () => {
    expect(matchesQuery(text, "периметр")).toBe(true);
  });

  it("требует все слова, но не подряд", () => {
    expect(matchesQuery(text, "бюджет периметру")).toBe(true);
    expect(matchesQuery(text, "бюджет расписание")).toBe(false);
  });

  it("не различает регистр и пустой запрос подходит всему", () => {
    expect(matchesQuery(text, "ОТЧЁТНЫЙ")).toBe(true);
    expect(matchesQuery(text, "   ")).toBe(true);
  });
});
