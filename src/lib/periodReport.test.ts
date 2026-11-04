import { describe, expect, it } from "vitest";
import { buildPeriodReport, changeOf, previousRange, rangeText, reportTitle, REST_LABEL, tableRows, packSections, previousRanges } from "./periodReport";
import { tx } from "../test/fixtures";
import type { Transaction } from "../types";

const color = () => "#000";

function base(input: Partial<Parameters<typeof buildPeriodReport>[0]> & { txs: Transaction[] }) {
  return buildPeriodReport({
    range: { from: "2026-01-01", to: "2026-06-30" },
    prevRange: null,
    maxDate: "2026-12-31",
    monthStartDay: 1,
    isMonth: false,
    colorOf: color,
    ...input,
  });
}

describe("previousRange", () => {
  it("год, квартал, месяц — прошлые такие же календарные", () => {
    expect(previousRange("year", { from: "2026-01-01", to: "2026-12-31" }, null, 1)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(previousRange("quarter", { from: "2026-01-01", to: "2026-03-31" }, null, 1)).toEqual({ from: "2025-10-01", to: "2025-12-31" });
    expect(previousRange("month", { from: "2026-03-01", to: "2026-03-31" }, "2026-03", 1)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("отчётный месяц — со своим первым днём", () => {
    expect(previousRange("period", { from: "2026-03-15", to: "2026-04-14" }, "2026-03", 15)).toEqual({ from: "2026-02-15", to: "2026-03-14" });
  });

  it("скользящее окно и свои даты — отрезок той же длины прямо перед", () => {
    expect(previousRange("30d", { from: "2026-03-02", to: "2026-03-31" }, null, 1)).toEqual({ from: "2026-01-31", to: "2026-03-01" });
    expect(previousRange("custom", { from: "2026-03-10", to: "2026-03-19" }, null, 1)).toEqual({ from: "2026-02-28", to: "2026-03-09" });
  });

  it("«Всё время» — сравнивать не с чем", () => {
    expect(previousRange("all", { from: "2020-01-01", to: "2026-03-31" }, null, 1)).toBeNull();
  });
});

describe("buildPeriodReport", () => {
  it("итоги, норма сбережений и сравнение с прошлым периодом", () => {
    const txs = [
      tx({ date: "2026-02-10", kind: "income", amount: 1000 }),
      tx({ date: "2026-02-11", amount: 600 }),
      tx({ date: "2026-02-12", kind: "refund", amount: 100 }),
      tx({ date: "2026-02-13", kind: "transfer", amount: 999 }),
      tx({ date: "2025-08-01", amount: 250 }),
    ];
    const r = base({ txs, prevRange: { from: "2025-07-01", to: "2025-12-31" } });
    expect(r.totals).toMatchObject({ income: 1000, expense: 500, net: 500, rate: 0.5 });
    expect(r.prevTotals).toMatchObject({ income: 0, expense: 250, rate: null });
  });

  it("длинный период — по отчётным месяцам, пустые месяцы на месте", () => {
    const txs = [tx({ date: "2026-01-05", amount: 100 }), tx({ date: "2026-04-05", amount: 300 })];
    const r = base({ txs });
    expect(r.bucket).toBe("month");
    expect(r.buckets.map((b) => b.key)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]);
    expect(r.buckets[1].expense).toBe(0);
    expect(r.buckets[3].expense).toBe(300);
  });

  it("короткий период — по дням", () => {
    const txs = [tx({ date: "2026-03-02", amount: 100 })];
    const r = base({ txs, range: { from: "2026-03-01", to: "2026-03-31" } });
    expect(r.bucket).toBe("day");
    expect(r.buckets).toHaveLength(31);
    expect(r.buckets[1]).toMatchObject({ key: "2026-03-02", expense: 100 });
  });

  it("идущий период — до последней операции, прошлый — тем же числом дней", () => {
    const txs = [tx({ date: "2026-03-10", amount: 100 }), tx({ date: "2026-02-20", amount: 999 }), tx({ date: "2026-02-05", amount: 50 })];
    const r = base({
      txs,
      range: { from: "2026-03-01", to: "2026-03-31" },
      prevRange: { from: "2026-02-01", to: "2026-02-28" },
      maxDate: "2026-03-10",
      isMonth: true,
    });
    expect(r.running).toBe(true);
    expect(r.lastDay).toBe("2026-03-10");
    expect(r.buckets).toHaveLength(10);
    expect(r.prevRange).toEqual({ from: "2026-02-01", to: "2026-02-10" });
    expect(r.prevTotals?.expense).toBe(50);
    expect(r.observations.find((o) => o.id === "halves")).toBeUndefined();
  });

  it("категории — топ с долями и прошлым, хвост свёрнут в «Остальное»", () => {
    const txs: Transaction[] = [];
    for (let i = 0; i < 10; i++) txs.push(tx({ date: "2026-02-01", category: `К${i}`, amount: 100 * (10 - i) }));
    txs.push(tx({ date: "2025-12-01", category: "К0", amount: 500 }));
    const r = base({ txs, prevRange: { from: "2025-07-01", to: "2025-12-31" } });
    const cats = r.expenseCategories;
    expect(cats).toHaveLength(9);
    expect(cats[0]).toMatchObject({ name: "К0", total: 1000, prev: 500 });
    expect(cats[0].share).toBeCloseTo(1000 / 5500);
    expect(cats[8]).toMatchObject({ name: REST_LABEL, total: 300, rest: true, prev: 0 });
    expect(cats.reduce((s, c) => s + c.share, 0)).toBeCloseTo(1);
  });

  it("получатели и крупные траты", () => {
    const txs = [
      tx({ date: "2026-02-01", payee: "Магазин", amount: 300 }),
      tx({ date: "2026-02-02", payee: "Магазин", amount: 200 }),
      tx({ date: "2026-02-03", payee: "Кафе", amount: 400 }),
    ];
    const r = base({ txs });
    expect(r.payees[0]).toMatchObject({ name: "Магазин", total: 500, count: 2 });
    expect(r.operations.map((o) => o.amount)).toEqual([400, 300, 200]);
    expect(r.operations[0]).toMatchObject({ payee: "Кафе", date: "2026-02-03" });
  });
});

describe("changeOf", () => {
  it("относительное изменение, без базы — null", () => {
    expect(changeOf(150, 100)).toBeCloseTo(0.5);
    expect(changeOf(50, 0)).toBeNull();
    expect(changeOf(50, null)).toBeNull();
  });
});

describe("reportTitle", () => {
  it("короткие имена периодов и даты для остальных", () => {
    expect(reportTitle("period", { from: "2026-10-15", to: "2026-11-14" }, "2026-10")).toBe("Октябрь 2026");
    expect(reportTitle("quarter", { from: "2026-10-01", to: "2026-12-31" }, "2026-11")).toBe("IV квартал 2026");
    expect(reportTitle("year", { from: "2026-01-01", to: "2026-12-31" }, null)).toBe("2026 год");
    expect(reportTitle("custom", { from: "2026-03-10", to: "2026-03-19" }, null)).toBe(rangeText({ from: "2026-03-10", to: "2026-03-19" }));
    expect(rangeText({ from: "2026-03-10", to: "2026-03-19" })).toBe("10.03.2026 — 19.03.2026");
  });
});

describe("tableRows", () => {
  it("до 13 месяцев — месяцами, больше — годами, по дням — без таблицы", () => {
    const mk = (keys: string[]) => keys.map((key) => ({ key, income: 10, expense: 4, net: 6 }));
    expect(tableRows({ bucket: "month", buckets: mk(["2026-01", "2026-02"]) })).toHaveLength(2);
    const many = Array.from({ length: 15 }, (_, i) => `${2025 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`);
    expect(tableRows({ bucket: "month", buckets: mk(many) })).toEqual([
      { key: "2025", kind: "year", income: 120, expense: 48, net: 72 },
      { key: "2026", kind: "year", income: 30, expense: 12, net: 18 },
    ]);
    expect(tableRows({ bucket: "day", buckets: mk(["2026-01-01"]) })).toEqual([]);
  });
});

describe("packSections", () => {
  it("блоки по порядку, не влезший — на следующий лист целиком", () => {
    expect(packSections([300, 300, 300, 100], 700, 20)).toEqual([[0, 1], [2, 3]]);
    expect(packSections([340, 340], 700, 20)).toEqual([[0, 1]]);
    expect(packSections([341, 340], 700, 20)).toEqual([[0], [1]]);
  });
  it("блок выше листа — на своём листе", () => {
    expect(packSections([100, 900, 100], 700, 20)).toEqual([[0], [1], [2]]);
  });
});

describe("buildPeriodReport — блоки из «Дайджеста»", () => {
  const mar = { from: "2026-03-01", to: "2026-03-31" };

  it("«обычно» — среднее предыдущих периодов внутри истории", () => {
    const txs = [
      tx({ date: "2026-01-10", amount: 100 }),
      tx({ date: "2026-02-10", amount: 300 }),
      tx({ date: "2026-03-10", amount: 500 }),
    ];
    const ranges = previousRanges("month", mar, "2026-03", 1, 6);
    expect(ranges).toHaveLength(6);
    expect(ranges[0]).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    const r = base({ txs, range: mar, typicalRanges: ranges });
    // Январь неполный (история с 10-го), декабрь и раньше — до первой
    // операции: в среднее идёт только февраль.
    expect(r.typical).toMatchObject({ expense: 300, periods: 1 });
  });

  it("траты по дням: дни без трат, самый дорогой день, в среднем", () => {
    const txs = [tx({ date: "2026-03-02", amount: 300 }), tx({ date: "2026-03-05", amount: 900 }), tx({ date: "2026-03-05", kind: "refund", amount: 100 })];
    const r = base({ txs, range: { from: "2026-03-01", to: "2026-03-10" } });
    expect(r.days).toMatchObject({ lived: 10, noSpend: 8, biggest: { date: "2026-03-05", expense: 800 } });
    expect(r.days.avg).toBeCloseTo(110);
  });

  it("где «выстрелило» — по модулю разницы, и рост, и падение", () => {
    const txs = [
      tx({ date: "2026-02-10", category: "Кафе", amount: 100 }),
      tx({ date: "2026-02-10", category: "Дом", amount: 5000 }),
      tx({ date: "2026-03-10", category: "Кафе", amount: 2100 }),
      tx({ date: "2026-03-10", category: "Дом", amount: 4900 }),
    ];
    const r = base({ txs, range: mar, prevRange: { from: "2026-02-01", to: "2026-02-28" } });
    expect(r.movers.map((m) => m.category)).toEqual(["Кафе", "Дом"]);
    expect(r.movers[0]).toEqual({ category: "Кафе", now: 2100, prev: 100 });
  });

  it("впервые — по всей истории, а не по отфильтрованным операциям", () => {
    const history = [
      tx({ date: "2025-05-01", payee: "Кофейня", account: "Наличные", amount: 50 }),
      tx({ date: "2026-03-03", payee: "Кофейня", amount: 200 }),
      tx({ date: "2026-03-04", payee: "Новый магазин", amount: 700 }),
    ];
    const r = base({ txs: history.slice(1), history, range: mar });
    expect(r.newPayees).toEqual([{ name: "Новый магазин", total: 700, count: 1 }]);
    expect(r.newPayeesCount).toBe(1);
  });
});
