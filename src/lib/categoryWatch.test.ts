import { describe, expect, it } from "vitest";
import type { Transaction } from "../types";
import { buildCategoryWatch, buildTagWatch, inWatched } from "./categoryWatch";

const tx = (
  date: string,
  category: string,
  amountBase: number,
  subcategory: string | null = null,
  kind: Transaction["kind"] = "expense"
) => ({ date, kind, amountBase, category, subcategory }) as Transaction;

describe("buildCategoryWatch", () => {
  const txs = [
    tx("2026-06-20", "Дом", 1),
    tx("2026-07-03", "Еда", 300, "Кафе"),
    tx("2026-07-25", "Еда", 700),
    tx("2026-08-04", "Еда", 100),
    tx("2026-09-02", "Еда", 200, "Кафе"),
    tx("2026-09-20", "Еда", 900),
    tx("2026-10-01", "Еда", 150, "Кафе"),
    tx("2026-10-02", "Еда", 20, "Кафе", "refund"),
    tx("2026-10-03", "Дом", 500),
    tx("2026-10-04", "Еда", 9000, null, "income"),
    tx("2026-10-05", "Еда", 60),
  ];

  it("идущий месяц сравнивается с такими же началами прошлых", () => {
    const w = buildCategoryWatch(txs, "Еда", null, "2026-10", 1, "2026-10-05");
    expect(w.nowAt).toBe(190);
    // Возврат — тоже операция статьи; доход в расходы не идёт.
    expect(w.count).toBe(3);
    expect(w.running).toBe(true);
    // Сентябрь, август, июль к пятому числу: 200, 100, 300.
    expect(w.avgMonths).toBe(3);
    expect(w.avgAt).toBeCloseTo(200);
    // Июнь — первый, неполный месяц истории: столбик есть, в среднее не идёт.
    expect(w.bars.map((b) => [b.ym, b.total])).toEqual([
      ["2026-06", 0],
      ["2026-07", 1000],
      ["2026-08", 100],
      ["2026-09", 1100],
      ["2026-10", 190],
    ]);
    expect(w.bars[w.bars.length - 1].current).toBe(true);
  });

  it("подкатегория считается отдельно от категории", () => {
    const w = buildCategoryWatch(txs, "Еда", "Кафе", "2026-10", 1, "2026-10-05");
    expect(w.nowAt).toBe(130);
    expect(w.avgAt).toBeCloseTo((200 + 0 + 300) / 3);
  });

  it("прошедший месяц берётся целиком", () => {
    const w = buildCategoryWatch(txs, "Еда", null, "2026-09", 1, "2026-10-05");
    expect(w.running).toBe(false);
    expect(w.nowAt).toBe(1100);
    expect(w.avgMonths).toBe(2);
    expect(w.avgAt).toBeCloseTo((100 + 1000) / 2);
  });

  it("без истории сравнивать не с чем", () => {
    const w = buildCategoryWatch([tx("2026-10-03", "Еда", 70)], "Еда", null, "2026-10", 1, "2026-10-05");
    expect(w.nowAt).toBe(70);
    expect(w.avgAt).toBeNull();
    expect(w.bars).toHaveLength(1);
  });

  it("inWatched: категория целиком или одна подкатегория", () => {
    expect(inWatched(tx("2026-10-01", "Еда", 1, "Кафе"), "Еда", null)).toBe(true);
    expect(inWatched(tx("2026-10-01", "Еда", 1, "Кафе"), "Еда", "Кафе")).toBe(true);
    expect(inWatched(tx("2026-10-01", "Еда", 1), "Еда", "Кафе")).toBe(false);
    expect(inWatched(tx("2026-10-01", "Дом", 1), "Еда", null)).toBe(false);
  });

  it("доходная категория считается по доходам, расходы и возвраты в неё не идут", () => {
    const w = buildCategoryWatch(txs, "Еда", null, "2026-10", 1, "2026-10-05", "income");
    expect(w.nowAt).toBe(9000);
    expect(w.count).toBe(1);
    expect(w.avgAt).toBe(0);
  });
});

describe("buildTagWatch", () => {
  const tagged = (date: string, kind: Transaction["kind"], amountBase: number, comment: string, extra: string[] = []) =>
    ({ date, kind, amountBase, comment, category: "Разное", extraCategories: extra }) as Transaction;
  const txs = [
    tagged("2026-08-03", "expense", 1, "начало истории"),
    tagged("2026-09-02", "expense", 400, "Билеты #отпуск"),
    tagged("2026-09-03", "income", 100, "Вернули за бронь #отпуск"),
    tagged("2026-10-01", "expense", 700, "Отель #отпуск"),
    tagged("2026-10-02", "refund", 50, "Возврат #отпуск"),
    tagged("2026-10-03", "income", 300, "Скинулись #отпуск"),
    tagged("2026-10-04", "expense", 999, "Без тега"),
    tagged("2026-10-04", "expense", 80, "", ["Отпуск"]),
  ];

  it("хэштег: расходы и доходы считаются врозь", () => {
    const w = buildTagWatch(txs, "отпуск", "hashtags", "2026-10", 1, "2026-10-05");
    expect(w.expense.nowAt).toBe(650);
    expect(w.income.nowAt).toBe(300);
    expect(w.expense.avgAt).toBe(400);
    expect(w.income.avgAt).toBe(100);
    expect(w.expense.bars.map((b) => b.total)).toEqual([0, 400, 650]);
    expect(w.income.bars.map((b) => b.total)).toEqual([0, 100, 300]);
  });

  it("вторая категория как тег — свой режим", () => {
    const w = buildTagWatch(txs, "Отпуск", "categories", "2026-10", 1, "2026-10-05");
    expect(w.expense.nowAt).toBe(80);
    expect(w.income.nowAt).toBe(0);
  });
});
