import { describe, it, expect } from "vitest";
import { dedupeLines, lineKey, nameKey, normalizeTagName } from "./budgetLines";
import type { BudgetLine } from "./budgets";

const line = (over: Partial<BudgetLine> = {}): BudgetLine => ({
  id: "l1",
  category: "Банк",
  subcategory: "Cash back",
  kind: "income",
  amount: 0,
  recurrence: "monthly",
  startMonth: "2026-01",
  endMonth: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("normalizeTagName — невидимая разница в имени", () => {
  it("хвостовой пробел не делает вторую статью", () => {
    expect(normalizeTagName("Cash back ")).toBe("Cash back");
  });

  it("неразрывный пробел приводится к обычному", () => {
    expect(normalizeTagName("Cash back")).toBe("Cash back");
  });

  it("двойной пробел внутри схлопывается", () => {
    expect(normalizeTagName("Cash  back")).toBe("Cash back");
  });

  it("пусто и null — одно и то же", () => {
    expect(nameKey("income", "Банк", null)).toBe(nameKey("income", "Банк", ""));
  });
});

describe("lineKey — чем опознаётся строка", () => {
  it("строка с тегом опознаётся тегом, а не именем", () => {
    const a = line({ tagId: "t-1", category: "Банк", subcategory: "Cashback" });
    const b = line({ id: "l2", tagId: "t-1", category: "Банк", subcategory: "Cash back" });
    expect(lineKey(a)).toBe(lineKey(b));
  });

  it("без тега — по именам", () => {
    expect(lineKey(line({ subcategory: "Cash back " }))).toBe(
      lineKey(line({ id: "l2", subcategory: "Cash back" }))
    );
  });

  it("разные статьи остаются разными", () => {
    expect(lineKey(line({ subcategory: "Кэшбек" }))).not.toBe(lineKey(line()));
  });
});

describe("dedupeLines — лечение задвоений", () => {
  it("КЛЮЧЕВОЕ: переименованная статья не двоится — планы сливаются", () => {
    // Ровно то, на что жалуются: в Дзен-мани категорию переименовали, синк
    // завёл вторую строку, и на экране две одинаковых «Cash back» с разными
    // планами, а у родителя — их сумма.
    const old = line({
      id: "old",
      tagId: "t-1",
      subcategory: "Cashback",
      overrides: { "2026-07": 3413.55 },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const fresh = line({
      id: "new",
      tagId: "t-1",
      subcategory: "Cash back",
      overrides: { "2026-08": 4209 },
      createdAt: "2026-08-01T00:00:00.000Z",
    });
    const { lines, merged } = dedupeLines([old, fresh]);
    expect(merged).toBe(1);
    expect(lines).toHaveLength(1);
    // Имя — новое, id — старый (он уже мог уехать в очередь отправки).
    expect(lines[0].subcategory).toBe("Cash back");
    expect(lines[0].id).toBe("old");
    expect(lines[0].overrides).toEqual({ "2026-07": 3413.55, "2026-08": 4209 });
  });

  it("спор за один месяц решает более поздняя строка", () => {
    const a = line({ id: "a", overrides: { "2026-08": 100 }, createdAt: "2026-01-01" });
    const b = line({ id: "b", overrides: { "2026-08": 200 }, createdAt: "2026-02-01" });
    expect(dedupeLines([a, b]).lines[0].overrides).toEqual({ "2026-08": 200 });
  });

  it("замки тоже сливаются", () => {
    const a = line({ id: "a", locks: { "2026-07": true }, createdAt: "2026-01-01" });
    const b = line({ id: "b", locks: { "2026-08": true }, createdAt: "2026-02-01" });
    expect(dedupeLines([a, b]).lines[0].locks).toEqual({
      "2026-07": true,
      "2026-08": true,
    });
  });

  it("окно действия расширяется до самого широкого", () => {
    const a = line({ id: "a", startMonth: "2026-05", endMonth: "2026-08" });
    const b = line({ id: "b", startMonth: "2026-01", endMonth: null, createdAt: "2026-02-01" });
    const [only] = dedupeLines([a, b]).lines;
    expect(only.startMonth).toBe("2026-01");
    expect(only.endMonth).toBeNull();
  });

  it("разные статьи не склеиваются, порядок сохраняется", () => {
    const a = line({ id: "a", subcategory: "Cash back" });
    const b = line({ id: "b", subcategory: "Проценты" });
    const { lines, merged } = dedupeLines([a, b]);
    expect(merged).toBe(0);
    expect(lines.map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("строка без тега и строка с тегом по одному имени не путаются", () => {
    // У них разное тождество, и склеивать их вслепую нельзя: тег знает,
    // к какой статье относится, а имя может совпасть случайно.
    const withTag = line({ id: "a", tagId: "t-1" });
    const noTag = line({ id: "b" });
    expect(dedupeLines([withTag, noTag]).merged).toBe(0);
  });

  it("пустой список не ломается", () => {
    expect(dedupeLines([])).toEqual({ lines: [], merged: 0 });
  });
});
