import { describe, it, expect } from "vitest";
import { buildCategoryReport } from "./categoryReport";
import { buildReportSheet, sheetColumns, moneyFormat } from "./categoryReportXlsx";
import type { Transaction } from "../types";

function tx(p: Partial<Transaction> & { date: string; amountBase: number }): Transaction {
  return {
    id: Math.random().toString(36).slice(2),
    category: "Еда",
    subcategory: null,
    categoryFull: "Еда",
    payee: "",
    comment: "",
    outcomeAccount: "Карта",
    outcomeAmount: 0,
    outcomeCurrency: "RUB",
    incomeAccount: "",
    incomeAmount: 0,
    incomeCurrency: "RUB",
    kind: "expense",
    amount: p.amountBase,
    currency: "RUB",
    account: "Карта",
    opAmount: null,
    opCurrency: null,
    createdAt: `${p.date}T00:00:00Z`,
    ...p,
  } as Transaction;
}

const sample = () =>
  buildCategoryReport(
    [
      tx({ date: "2026-06-01", amountBase: 100, category: "Еда", subcategory: "Кафе", categoryFull: "Еда / Кафе" }),
      tx({ date: "2026-07-01", amountBase: 200, category: "Еда" }),
      tx({ date: "2026-07-02", amountBase: 5000, kind: "income", category: "Зарплата", categoryFull: "Зарплата" }),
    ],
    "month"
  );

describe("categoryReportXlsx — лист для Excel", () => {
  it("денежный формат зависит от базовой валюты", () => {
    expect(moneyFormat("RUB")).toContain("₽");
    expect(moneyFormat("USD")).toContain("USD");
  });

  it("шапка, блоки «Доход» / «Расход» / «Разница» и итоговый столбец", () => {
    const report = sample();
    const sheet = buildReportSheet(report, "RUB");
    const first = (row: (unknown | null)[]) =>
      (row[0] as { value?: string } | null)?.value ?? null;

    expect(first(sheet[0])).toBe("Категория");
    expect(sheet[0][sheet[0].length - 1]).toMatchObject({ value: "Итого" });
    expect(first(sheet[1])).toBe("Доход");
    expect(sheet.map(first)).toContain("Расход");
    expect(first(sheet[sheet.length - 1])).toBe("Разница");

    // Ширина строк одинакова: категория + периоды + итог.
    const width = report.columns.length + 2;
    expect(new Set(sheet.map((r) => r.length))).toEqual(new Set([width]));
    expect(sheetColumns(report)).toHaveLength(width);
  });

  it("суммы уходят числами с денежным форматом, а не текстом", () => {
    const sheet = buildReportSheet(sample(), "RUB");
    const incomeRow = sheet[1];
    const cell = incomeRow[incomeRow.length - 1] as { value: number; type: unknown; format: string };
    expect(cell.type).toBe(Number);
    expect(cell.value).toBe(5000);
    expect(cell.format).toBe(moneyFormat("RUB"));
  });

  it("подкатегория получает отступ, родитель — нет", () => {
    const sheet = buildReportSheet(sample(), "RUB");
    const named = (name: string) =>
      sheet.find((r) => (r[0] as { value?: string } | null)?.value === name)?.[0] as
        | { indent?: number }
        | undefined;
    expect(named("Еда")?.indent).toBe(0);
    expect(named("Кафе")?.indent).toBe(1);
  });

  it("при одном столбце «Итого» не дублируется", () => {
    const report = buildCategoryReport(
      [tx({ date: "2026-07-01", amountBase: 200, category: "Еда" })],
      "total"
    );
    const sheet = buildReportSheet(report, "RUB");
    expect(sheet[0]).toHaveLength(2);
    expect(sheetColumns(report)).toHaveLength(2);
    expect(sheet[0].map((c) => (c as { value?: string } | null)?.value)).toEqual([
      "Категория",
      "За всё время",
    ]);
  });

  it("итог по строке равен сумме её периодов", () => {
    const report = sample();
    const sheet = buildReportSheet(report, "RUB");
    const row = sheet.find((r) => (r[0] as { value?: string } | null)?.value === "Еда")!;
    const values = row.slice(1, -1).map((c) => (c as { value: number }).value);
    const total = (row[row.length - 1] as { value: number }).value;
    expect(values.reduce((a, b) => a + b, 0)).toBe(total);
    expect(total).toBe(300);
  });
});

/**
 * Настоящая запись файла: наш лист должен пройти через писатель без правок и
 * дать валидный .xlsx (zip). Тест ловит расхождения с форматом пакета — их из
 * структуры данных не видно, а пользователь получил бы битый файл.
 */
describe("categoryReportXlsx — файл собирается", () => {
  it("write-excel-file принимает наш лист и отдаёт валидный xlsx", async () => {
    const { default: writeXlsxFile } = await import("write-excel-file/node");
    const report = sample();
    const buf = await writeXlsxFile(buildReportSheet(report, "RUB") as never, {
      sheet: "Доходы и расходы",
      columns: sheetColumns(report),
      stickyRowsCount: 1,
      stickyColumnsCount: 1,
    }).toBuffer();
    // Сигнатура zip — Excel-файл это zip-архив.
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(buf.length).toBeGreaterThan(1000);
  });
});
