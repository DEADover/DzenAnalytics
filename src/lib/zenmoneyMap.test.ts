import { describe, it, expect } from "vitest";
import { mapZenmoneyDiff } from "./zenmoneyMap";
import type { ZenTag, ZenDiffResponse } from "./zenmoney";

function tag(over: Partial<ZenTag> & { id: string; title: string }): ZenTag {
  return {
    user: 1,
    changed: 0,
    parent: null,
    archive: false,
    showIncome: false,
    showOutcome: true,
    budgetIncome: false,
    budgetOutcome: false,
    required: null,
    icon: null,
    picture: null,
    color: null,
    ...over,
  } as ZenTag;
}

/** Colour the mapper assigns to a category, given a raw `tag.color` int. */
function colorOf(color: number | null): string | null {
  const diff = { tag: [tag({ id: "t", title: "Кат", color })] } as ZenDiffResponse;
  return mapZenmoneyDiff(diff).categoryMeta["Кат"]?.color ?? null;
}

describe("mapZenmoneyDiff — category colour decode", () => {
  // Regression: Zenmoney stores most colours as plain RGB with a ZERO alpha
  // byte (small positive int). We must decode the low 24 bits and ignore alpha
  // (like Zerro) — an earlier `alpha === 0 → null` check silently dropped the
  // real colour of ~78% of categories for such users.
  it("decodes plain RGB colours stored with a zero alpha byte", () => {
    expect(colorOf(4499017)).toBe("rgb(68, 166, 73)"); // #44a649
    expect(colorOf(2668278)).toBe("rgb(40, 182, 246)"); // #28b6f6
    expect(colorOf(1533116)).toBe("rgb(23, 100, 188)"); // #1764bc
    expect(colorOf(16777215)).toBe("rgb(255, 255, 255)"); // white, alpha 0
  });

  it("still decodes ARGB colours with full alpha (0xFF)", () => {
    expect(colorOf(4294967295)).toBe("rgb(255, 255, 255)"); // 0xFFFFFFFF
    expect(colorOf(4279723196)).toBe("rgb(23, 100, 188)"); // 0xFF1764BC — same RGB as 1533116
  });

  it("treats only a missing colour as 'no colour'", () => {
    expect(colorOf(null)).toBeNull();
  });
});

describe("mapZenmoneyDiff — вторые категории (#69)", () => {
  const tags = [
    tag({ id: "food", title: "Еда" }),
    tag({ id: "trip", title: "Путешествия" }),
    tag({ id: "italy", title: "Италия", parent: "trip" }),
    tag({ id: "vac", title: "Отпуск" }),
  ];
  const run = (tagIds: string[] | null) => {
    const diff = {
      instrument: [{ id: 2, shortTitle: "RUB", rate: 1 }],
      user: [{ id: 1, currency: 2 }],
      account: [{ id: "a", title: "Карта", instrument: 2, type: "ccard", archive: false, inBalance: true }],
      tag: tags,
      transaction: [
        {
          id: "tx", date: "2026-09-01", created: 0, deleted: false,
          outcome: 500, outcomeAccount: "a", outcomeInstrument: 2,
          income: 0, incomeAccount: "a", incomeInstrument: 2,
          tag: tagIds, payee: "", comment: "", merchant: null,
        },
      ],
    } as unknown as ZenDiffResponse;
    return mapZenmoneyDiff(diff).transactions[0];
  };

  it("основная — первая, остальные попадают во вторые полными названиями", () => {
    const t = run(["food", "vac", "italy"]);
    expect(t.categoryFull).toBe("Еда");
    expect(t.extraCategories).toEqual(["Отпуск", "Путешествия / Италия"]);
  });

  it("у операции с одной категорией вторых нет вовсе", () => {
    expect(run(["food"]).extraCategories).toBeUndefined();
  });

  it("повтор основной и неизвестный тег отбрасываются", () => {
    expect(run(["food", "food", "ghost", "vac"]).extraCategories).toEqual(["Отпуск"]);
  });
});
