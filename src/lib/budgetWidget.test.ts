import { describe, expect, it } from "vitest";
import type { BudgetMonthRow } from "./budgetMonth";
import { buildBudgetWidget } from "./budgetWidget";

const row = (
  category: string,
  planned: number,
  fact: number,
  extra: Partial<BudgetMonthRow> & { kind?: "expense" | "income"; subcategory?: string | null } = {}
) => {
  const { kind = "expense", subcategory = null, ...rest } = extra;
  return {
    line: { kind, category, subcategory },
    planned,
    fact,
    forecast: false,
    ...rest,
  } as unknown as BudgetMonthRow;
};

describe("buildBudgetWidget", () => {
  it("берёт расходные статьи с планом, самые потраченные первыми", () => {
    const w = buildBudgetWidget([
      row("Еда", 25_000, 13_000),
      row("Кафе", 5_000, 11_800),
      row("Зарплата", 150_000, 150_000, { kind: "income" }),
      row("Такси", 0, 455),
      row("Накопления", 20_000, 20_000, { planGroup: true }),
      row("Без категории", 0, 300, { unplanned: true }),
      row("Дом", 35_000, 35_000),
      row("Еда", 2_000, 2_400, { subcategory: "Сладкое" }),
    ]);
    // «Еда» и «Сладкое» — одна ветка: 15 400 из 27 000.
    expect(w.rows.map((r) => r.key)).toEqual(["Кафе|", "Дом|", "Еда|"]);
    expect(w.rows[2]).toMatchObject({ planned: 27_000, fact: 15_400 });
    expect(w.rows[2].children?.map((c) => c.key)).toEqual(["Еда|Сладкое"]);
    expect(w.over).toBe(2);
    expect(w.total).toBe(4);
    expect(w.rows[0].ratio).toBeCloseTo(2.36);
  });

  it("при равной доле выше статья с большим планом", () => {
    const w = buildBudgetWidget([row("А", 1_000, 500), row("Б", 10_000, 5_000)]);
    expect(w.rows.map((r) => r.category)).toEqual(["Б", "А"]);
    expect(w.over).toBe(0);
  });

  it("без планов строк нет", () => {
    expect(buildBudgetWidget([])).toEqual({ rows: [], total: 0, over: 0, overBy: 0, left: 0 });
  });

  it("категория под замком — вся ветка: траты подкатегорий входят в неё (#141)", () => {
    // «Жильё» 60 000 под замком = «Аренда» 50 000 + «Коммуналка» 10 000. В
    // расчёте раздела у «Жилья» своих трат нет — всё ушло в подкатегории.
    const w = buildBudgetWidget([
      row("Жильё", 60_000, 0, { locked: true }),
      row("Жильё", 50_000, 50_000, { subcategory: "Аренда" }),
      row("Жильё", 10_000, 12_000, { subcategory: "Коммуналка" }),
    ]);
    expect(w.rows).toHaveLength(1);
    expect(w.rows[0]).toMatchObject({ key: "Жильё|", planned: 60_000, fact: 62_000 });
    expect(w.rows[0].children?.map((c) => c.subcategory)).toEqual(["Коммуналка", "Аренда"]);
    // Под замком считается только категория: перебор «Коммуналки» гасится
    // в её сумме, отдельной статьёй она не идёт.
    expect(w).toMatchObject({ total: 1, over: 1, overBy: 2_000, left: 0 });
  });

  it("без замка план категории — своя сумма плюс подкатегории, статьи считаются по отдельности", () => {
    const w = buildBudgetWidget([
      row("Дети", 5_000, 1_000),
      row("Дети", 10_000, 12_500, { subcategory: "Секции" }),
      row("Дети", 3_000, 1_000, { subcategory: "Игрушки" }),
    ]);
    expect(w.rows[0]).toMatchObject({ planned: 18_000, fact: 14_500 });
    // Перебор «Секций» не гасится остатком соседей.
    expect(w).toMatchObject({ total: 3, over: 1, overBy: 2_500, left: 6_000 });
  });

  it("отрицательная своя сумма категории — поправка к подкатегориям", () => {
    const w = buildBudgetWidget([
      row("Авто", -1_000, 0),
      row("Авто", 4_000, 1_000, { subcategory: "Бензин" }),
      row("Авто", 2_000, 0, { subcategory: "Мойка" }),
    ]);
    expect(w.rows[0]).toMatchObject({ planned: 5_000, fact: 1_000 });
    expect(w.total).toBe(2);
  });

  it("одна подкатегория без плана категории — обычной строкой", () => {
    const w = buildBudgetWidget([row("Еда", 2_000, 500, { subcategory: "Сладкое" })]);
    expect(w.rows).toEqual([expect.objectContaining({ key: "Еда|Сладкое", subcategory: "Сладкое" })]);
    expect(w.rows[0].children).toBeUndefined();
  });

  it("несколько подкатегорий без плана категории — веткой с их суммой", () => {
    const w = buildBudgetWidget([
      row("Еда", 2_000, 500, { subcategory: "Сладкое" }),
      row("Еда", 8_000, 9_000, { subcategory: "Продукты" }),
    ]);
    expect(w.rows[0]).toMatchObject({ key: "Еда|", subcategory: null, planned: 10_000, fact: 9_500 });
    expect(w).toMatchObject({ total: 2, over: 1, overBy: 1_000, left: 1_500 });
  });
});
