import { describe, expect, it } from "vitest";
import type { Transaction } from "../types";
import { buildCompareTrack } from "./compareTrack";

const tx = (date: string, kind: Transaction["kind"], amountBase: number) =>
  ({ date, kind, amountBase }) as Transaction;

describe("buildCompareTrack", () => {
  const txs = [
    tx("2026-09-01", "expense", 100),
    tx("2026-09-03", "expense", 50),
    tx("2026-09-03", "income", 999),
    tx("2026-09-30", "expense", 1000),
    tx("2026-10-01", "expense", 200),
    tx("2026-10-02", "refund", 30),
    tx("2026-10-02", "transfer", 5000),
    tx("2026-10-05", "expense", 10),
  ];
  const octFull = { from: "2026-10-01", to: "2026-10-31" };
  const sep = { from: "2026-09-01", to: "2026-09-30" };

  it("идущий месяц обрывается на последнем дне с данными, прошлый — целиком", () => {
    const t = buildCompareTrack(txs, "expense", { full: octFull, to: "2026-10-05" }, [sep]);
    expect(t.days).toBe(31);
    expect(t.aDays).toBe(5);
    expect(t.running).toBe(true);
    expect(t.points.map((p) => p.a).slice(0, 6)).toEqual([200, 170, 170, 170, 180, null]);
    // Возврат уменьшает расход, переводы и доходы не считаются.
    expect(t.aTotal).toBe(180);
    expect(t.bAtA).toBe(150);
    expect(t.bTotal).toBe(1150);
    // 31-го дня в сентябре нет — у Б на оси он пустой.
    expect(t.points[30].b).toBeNull();
    expect(t.points[30].dateA).toBe("2026-10-31");
    expect(t.points[29].dateB).toBe("2026-09-30");
  });

  it("доходы считает отдельно", () => {
    const t = buildCompareTrack(txs, "income", { full: octFull, to: "2026-10-05" }, [sep]);
    expect(t.aTotal).toBe(0);
    expect(t.bTotal).toBe(999);
  });

  it("среднее по нескольким окнам: короткое окно после конца держит итог", () => {
    const many = [
      tx("2026-09-01", "expense", 300),
      tx("2026-08-01", "expense", 100),
      tx("2026-08-31", "expense", 100),
    ];
    const t = buildCompareTrack(
      many,
      "expense",
      { full: octFull, to: "2026-10-31" },
      [sep, { from: "2026-08-01", to: "2026-08-31" }]
    );
    expect(t.points[0].b).toBe((300 + 100) / 2);
    // 31-й день: в сентябре его нет — берётся итог сентября (300), в августе 200.
    expect(t.points[30].b).toBe((300 + 200) / 2);
    expect(t.running).toBe(false);
  });

  it("без данных и без периода Б — пустые линии, без падений", () => {
    const t = buildCompareTrack([], "expense", { full: octFull, to: "" }, []);
    expect(t.aDays).toBe(0);
    expect(t.points.every((p) => p.a === null && p.b === null)).toBe(true);
    expect(t.bTotal).toBe(0);
  });
});
