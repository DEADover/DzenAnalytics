import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { PeriodReport } from "../hooks/usePeriodReport";
import { tx } from "../test/fixtures";
import { buildPeriodReport } from "./periodReport";
import { buildPeriodReportWorkbook, type Cell, type Sheet } from "./periodReportXlsx";
import { reportHeadline } from "./periodReportText";

function report(extra: Partial<PeriodReport> = {}): PeriodReport {
  const txs = [
    tx({ date: "2026-10-01", kind: "income", amount: 100_000, category: "Зарплата" }),
    tx({ date: "2026-10-03", amount: 12_000, category: "Продукты", payee: "Пятёрочка" }),
    tx({ date: "2026-10-05", amount: 30_000, category: "Жильё", payee: "УК", comment: "Квартплата за октябрь" }),
    tx({ date: "2026-10-20", amount: 4_000, category: "Продукты", payee: "Лавка" }),
    tx({ date: "2026-09-10", amount: 20_000, category: "Продукты", payee: "Пятёрочка" }),
  ];
  const model = buildPeriodReport({
    txs,
    range: { from: "2026-10-01", to: "2026-10-31" },
    prevRange: { from: "2026-09-01", to: "2026-09-30" },
    maxDate: "2026-10-31",
    monthStartDay: 1,
    isMonth: true,
    colorOf: () => "#000",
  });
  return {
    ...model,
    title: "Октябрь 2026",
    isMonth: true,
    dates: "01.10.2026 — 31.10.2026",
    base: "RUB",
    capital: { start: 500_000, end: 554_000 },
    accounts: [],
    budget: null,
    ...extra,
  };
}

const byName = (sheets: Sheet[], name: string) => sheets.find((s) => s.sheet === name)!;
/** Строка листа, у которой первая ячейка — этот текст. */
const rowOf = (s: Sheet, first: string) => s.data.find((r) => (r[0] as Cell | null)?.value === first)!;

describe("«Отчёт за период» в Excel", () => {
  it("листы по разделам отчёта; счетов нет — нет и листа, бюджета нет — тоже", () => {
    const sheets = buildPeriodReportWorkbook(report(), "06.11.2026");
    expect(sheets.map((s) => s.sheet)).toEqual(["Итоги", "По дням", "Категории", "Получатели", "Самое дорогое"]);
  });

  it("итоги — числами с денежным форматом, норма сбережений — процентом, к прошлому — долей", () => {
    const s = byName(buildPeriodReportWorkbook(report(), "06.11.2026"), "Итоги");
    const exp = rowOf(s, "Расходы");
    expect(exp[1]).toMatchObject({ value: 46_000, type: Number, format: '#,##0.00" ₽"' });
    expect(exp[2]).toMatchObject({ value: 20_000 });
    expect((exp[4] as Cell).value).toBeCloseTo(46_000 / 20_000 - 1);
    expect(rowOf(s, "Норма сбережений")[1]).toMatchObject({ value: 0.54, format: "0.0%" });
    expect(rowOf(s, "Капитал")[3]).toMatchObject({ value: 54_000 });
  });

  it("фраза «Главное» — та же, что на листах PDF и HTML, без служебных меток сумм", () => {
    const r = report();
    const s = byName(buildPeriodReportWorkbook(r, "06.11.2026"), "Итоги");
    const lead = s.data.find((row) => (row[0] as Cell | null)?.wrap)![0] as Cell;
    expect(lead.value).toBe(reportHeadline(r).replace(/[⁠⁣]/g, ""));
    expect(String(lead.value)).not.toMatch(/[⁠⁣]/);
  });

  it("месяц — по дням: даты настоящими датами полночью UTC, итог внизу сходится", () => {
    const s = byName(buildPeriodReportWorkbook(report(), "06.11.2026"), "По дням");
    const first = s.data[1][0] as Cell;
    expect(first.type).toBe(Date);
    expect((first.value as Date).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(s.data).toHaveLength(1 + 31 + 1);
    expect(rowOf(s, "Итого")[2]).toMatchObject({ value: 46_000 });
  });

  it("крупные траты — с датой, получателем, категорией и комментарием", () => {
    const s = byName(buildPeriodReportWorkbook(report(), "06.11.2026"), "Самое дорогое");
    expect(s.data[1].map((c) => (c as Cell | null)?.value)).toEqual([
      new Date(Date.UTC(2026, 9, 5)),
      "УК",
      "Жильё",
      30_000,
      "Квартплата за октябрь",
    ]);
  });

  it("счета и бюджет — своими листами, когда они есть", () => {
    const r = report({
      accounts: [{ key: "a1", label: "Карта", start: 100_000, end: 154_000 }],
      budget: {
        months: ["2026-10"],
        plan: { income: 90_000, expense: 40_000 },
        fact: { income: 100_000, expense: 46_000 },
        rows: [{ category: "Продукты", plan: 15_000, fact: 16_000 }],
        plannedFact: 16_000,
        unplanned: 30_000,
      },
    });
    const sheets = buildPeriodReportWorkbook(r, "06.11.2026");
    expect(sheets.map((s) => s.sheet)).toEqual(["Итоги", "По дням", "Категории", "Получатели", "Самое дорогое", "Счета", "Бюджет"]);
    const row = rowOf(byName(sheets, "Бюджет"), "Продукты");
    expect(row.slice(1).map((c) => (c as Cell | null)?.value)).toEqual([15_000, 16_000, -1_000, 16_000 / 15_000]);
    expect(rowOf(byName(sheets, "Счета"), "Карта")[3]).toMatchObject({ value: 54_000 });
  });

  it("длинный период — лист «По месяцам» с названиями месяцев", () => {
    const r = report();
    const long = { ...r, bucket: "month" as const, buckets: [{ key: "2026-10", income: 100_000, expense: 46_000, net: 54_000 }] };
    const s = byName(buildPeriodReportWorkbook(long, "06.11.2026"), "По месяцам");
    expect((s.data[1][0] as Cell).value).toBe("Октябрь 2026");
  });

  it("write-excel-file принимает книгу: в файле все листы", async () => {
    const { default: writeXlsxFile } = await import("write-excel-file/node");
    const sheets = buildPeriodReportWorkbook(report(), "06.11.2026");
    const buf = await writeXlsxFile(sheets as never).toBuffer();
    const zip = unzipSync(new Uint8Array(buf));
    const workbook = strFromU8(zip["xl/workbook.xml"]);
    for (const s of sheets) expect(workbook).toContain(`name="${s.sheet}"`);
  });
});
