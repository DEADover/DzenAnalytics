import { describe, expect, it } from "vitest";
import type { Transaction } from "../types";
import { buildSpendingPace, paceCategories } from "./spendingPace";

const tx = (date: string, kind: Transaction["kind"], amountBase: number) =>
  ({ date, kind, amountBase }) as Transaction;

describe("buildSpendingPace", () => {
  const txs = [
    tx("2026-06-20", "expense", 5),
    tx("2026-07-02", "expense", 300),
    tx("2026-08-02", "expense", 100),
    tx("2026-08-20", "expense", 400),
    tx("2026-09-01", "expense", 100),
    tx("2026-09-03", "expense", 50),
    tx("2026-09-30", "expense", 1000),
    tx("2026-10-01", "expense", 200),
    tx("2026-10-02", "refund", 30),
    tx("2026-10-02", "transfer", 5000),
    tx("2026-10-05", "expense", 10),
  ];

  it("идущий месяц обрывается на сегодня, прошлый и среднее идут до конца", () => {
    const p = buildSpendingPace(txs, "2026-10", 1, "2026-10-05");
    expect(p.points).toHaveLength(31);
    expect(p.nowDays).toBe(5);
    expect(p.running).toBe(true);
    expect(p.points.slice(0, 6).map((x) => x.now)).toEqual([200, 170, 170, 170, 180, null]);
    expect(p.nowAt).toBe(180);
    // Сентябрь к пятому числу — 150, целиком — 1150.
    expect(p.prevAt).toBe(150);
    expect(p.prevTotal).toBe(1150);
    // Сентябрь, август, июль к пятому числу: 150, 100, 300.
    expect(p.avgMonths).toBe(3);
    expect(p.avgAt).toBeCloseTo((150 + 100 + 300) / 3);
    expect(p.points[0].date).toBe("2026-10-01");
    // 31-го в сентябре нет.
    expect(p.points[30].prev).toBeNull();
  });

  it("прошедший месяц сравнивается целиком", () => {
    const p = buildSpendingPace(txs, "2026-09", 1, "2026-10-05");
    expect(p.running).toBe(false);
    expect(p.nowDays).toBe(30);
    expect(p.nowAt).toBe(1150);
    expect(p.prevAt).toBe(500);
    // Июнь — первый, неполный месяц истории: в среднее не идёт.
    expect(p.avgMonths).toBe(2);
    expect(p.avgAt).toBeCloseTo((500 + 300) / 2);
  });

  it("без истории сравнивать не с чем", () => {
    const only = [tx("2026-10-03", "expense", 70)];
    const p = buildSpendingPace(only, "2026-10", 1, "2026-10-04");
    expect(p.nowAt).toBe(70);
    expect(p.prevAt).toBeNull();
    expect(p.prevTotal).toBeNull();
    expect(p.avgAt).toBeNull();
    expect(p.avgMonths).toBe(0);
    expect(p.points.every((x) => x.prev === null && x.avg === null)).toBe(true);
  });

  it("одного полного месяца для среднего мало — остаётся только прошлый", () => {
    const p = buildSpendingPace(txs, "2026-08", 1, "2026-10-05");
    expect(p.prevAt).toBe(300);
    expect(p.avgMonths).toBe(0);
    expect(p.avgAt).toBeNull();
  });

  it("месяц, который ещё не начался, пуст", () => {
    const p = buildSpendingPace(txs, "2026-11", 1, "2026-10-05");
    expect(p.nowDays).toBe(0);
    expect(p.nowAt).toBe(0);
    expect(p.points.every((x) => x.now === null)).toBe(true);
  });

  it("свой первый день месяца: дни считаются от него", () => {
    const own = [tx("2026-08-10", "expense", 1), tx("2026-09-29", "expense", 40), tx("2026-10-28", "expense", 90)];
    const p = buildSpendingPace(own, "2026-10", 28, "2026-10-29");
    expect(p.points[0].date).toBe("2026-10-28");
    expect(p.nowDays).toBe(2);
    expect(p.nowAt).toBe(90);
    // Прошлый период — с 28 сентября; 29-е — его второй день.
    expect(p.prevAt).toBe(40);
  });
});

describe("paceCategories", () => {
  const ctx = (date: string, category: string, amountBase: number, kind: Transaction["kind"] = "expense") =>
    ({ date, kind, amountBase, category }) as Transaction;
  const txs = [
    ctx("2026-09-02", "Еда", 100),
    ctx("2026-09-04", "Такси", 40),
    ctx("2026-09-20", "Еда", 900),
    ctx("2026-10-01", "Еда", 150),
    ctx("2026-10-02", "Еда", 20, "refund"),
    ctx("2026-10-03", "Дом", 500),
    ctx("2026-10-03", "", 30),
    ctx("2026-10-04", "Зарплата", 9000, "income"),
  ];

  it("берёт от прошлого месяца столько же дней и сходится с итогом", () => {
    const rows = paceCategories(txs, "2026-10", 1, "2026-10-05", 2);
    expect(rows).toEqual([
      { name: "Дом", now: 500, prev: 0 },
      { name: "Еда", now: 130, prev: 100 },
      // «Без категории» этого месяца и «Такси» прошлого.
      { name: "Остальное", now: 30, prev: 40, rest: true },
    ]);
    const pace = buildSpendingPace(txs, "2026-10", 1, "2026-10-05");
    expect(rows.reduce((s, r) => s + r.now, 0)).toBe(pace.nowAt);
    expect(rows.reduce((s, r) => s + (r.prev ?? 0), 0)).toBe(pace.prevAt);
  });

  it("прошедший месяц сравнивается с прошлым целиком", () => {
    const rows = paceCategories(txs, "2026-10", 1, "2026-11-10", 1);
    expect(rows[0]).toEqual({ name: "Дом", now: 500, prev: 0 });
    expect(rows[1]).toEqual({ name: "Остальное", now: 160, prev: 1040, rest: true });
  });

  it("без истории прошлого нет", () => {
    const rows = paceCategories([ctx("2026-10-03", "Дом", 500)], "2026-10", 1, "2026-10-05");
    expect(rows).toEqual([{ name: "Дом", now: 500, prev: null }]);
  });
});
