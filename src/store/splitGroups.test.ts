import { describe, it, expect } from "vitest";
import {
  indexPartsByGroup,
  partNumber,
  type SplitGroup,
} from "./useSplitGroupsStore";

const group = (sourceId: string, ids: string[]): SplitGroup => ({
  sourceId,
  createdAt: "2026-08-30T10:00:00.000Z",
  date: "2026-08-20",
  payee: "Перекрёсток",
  originalAmount: 3000,
  originalCategory: "Еда",
  originalSubcategory: null,
  parts: ids.map((id, i) => ({
    id,
    category: ["Еда", "Дом", "Питомцы"][i] ?? "Прочее",
    subcategory: null,
    amount: 1000,
  })),
});

describe("indexPartsByGroup", () => {
  it("по id любой части находится её разбивка", () => {
    const index = indexPartsByGroup({
      a: group("a", ["a", "a2", "a3"]),
      b: group("b", ["b", "b2"]),
    });
    // Исходная операция — тоже часть, и по ней разбивка находится так же.
    expect(index.get("a")?.sourceId).toBe("a");
    expect(index.get("a3")?.sourceId).toBe("a");
    expect(index.get("b2")?.sourceId).toBe("b");
  });

  it("операция вне разбивки ничего не находит", () => {
    const index = indexPartsByGroup({ a: group("a", ["a", "a2"]) });
    expect(index.get("посторонняя")).toBeUndefined();
  });

  it("пустой список групп — пустая карта, а не падение", () => {
    expect(indexPartsByGroup({}).size).toBe(0);
  });

  it("в карте столько записей, сколько всего частей", () => {
    // Карта строится один раз на изменение состава: перебирать группы на
    // каждую строку ленты в тысячи строк нельзя.
    const index = indexPartsByGroup({
      a: group("a", ["a", "a2", "a3"]),
      b: group("b", ["b", "b2"]),
    });
    expect(index.size).toBe(5);
  });
});

describe("partNumber", () => {
  it("нумерует части с единицы, исходная — первая", () => {
    const g = group("a", ["a", "a2", "a3"]);
    expect(partNumber(g, "a")).toBe(1);
    expect(partNumber(g, "a2")).toBe(2);
    expect(partNumber(g, "a3")).toBe(3);
  });

  it("чужой id — ноль, а не минус первый", () => {
    // Ноль читается как «не часть»; −1 из `findIndex` протёк бы в интерфейс
    // подписью «часть 0 из 3».
    expect(partNumber(group("a", ["a", "a2"]), "чужая")).toBe(0);
  });
});
