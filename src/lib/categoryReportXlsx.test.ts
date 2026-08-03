import { describe, it, expect } from "vitest";
import { buildCategoryReport } from "./categoryReport";
import {
  addRowOutline,
  buildReportSheet,
  moneyFormat,
  outlineRowNumbers,
  sheetColumns,
} from "./categoryReportXlsx";
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

describe("categoryReportXlsx — формат сумм", () => {
  it("денежный формат несёт знак валюты", () => {
    expect(moneyFormat("RUB")).toBe('#,##0.00" ₽"');
    expect(moneyFormat("USD")).toBe('#,##0.00" USD"');
  });

  it("числовой формат — без валюты, но с двумя знаками", () => {
    expect(moneyFormat("RUB", "plain")).toBe("#,##0.00");
    expect(moneyFormat("USD", "plain")).toBe("#,##0.00");
  });

  it("выбранный формат доезжает до ячеек листа", () => {
    const report = buildCategoryReport([tx({ date: "2026-07-01", amountBase: 100 })], "month", 1);
    const plain = buildReportSheet(report, "RUB", "plain");
    const cells = plain.flat().filter((c) => c && typeof c.value === "number");
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) expect(c!.format).toBe("#,##0.00");
  });

  it("суммы остаются числами, а не текстом", () => {
    const report = buildCategoryReport([tx({ date: "2026-07-01", amountBase: 100 })], "month", 1);
    const cells = buildReportSheet(report, "RUB", "plain")
      .flat()
      .filter((c) => c && typeof c.value === "number");
    for (const c of cells) expect(c!.type).toBe(Number);
  });
});

describe("categoryReportXlsx — базовая валюта", () => {
  const report = () =>
    buildCategoryReport(
      [
        tx({ date: "2026-06-01", amountBase: 100 }),
        tx({ date: "2026-07-01", amountBase: 100 }),
      ],
      "month",
      1
    );

  it("рубль не зашит: формат идёт от переданной валюты", () => {
    const usd = buildReportSheet(report(), "USD")
      .flat()
      .filter((c) => c && typeof c.value === "number");
    expect(usd.length).toBeGreaterThan(0);
    for (const c of usd) expect(c!.format).toBe('#,##0.00" USD"');
    const rub = buildReportSheet(report(), "RUB")
      .flat()
      .filter((c) => c && typeof c.value === "number");
    for (const c of rub) expect(c!.format).toBe('#,##0.00" ₽"');
  });

  it("числовой формат не тянет валюту ни при какой базе", () => {
    for (const cur of ["RUB", "USD", "AMD"]) {
      const cells = buildReportSheet(report(), cur, "plain")
        .flat()
        .filter((c) => c && typeof c.value === "number");
      for (const c of cells) expect(c!.format).toBe("#,##0.00");
    }
  });
});

describe("categoryReportXlsx — группировка подкатегорий", () => {
  const report = () =>
    buildCategoryReport(
      [
        // `categoryFull` задаём явно: локальный хелпер по умолчанию ставит «Еда»,
        // и без этого разные подкатегории схлопнулись бы в одну строку.
        tx({
          date: "2026-07-01",
          amountBase: 500,
          category: "Зарплата",
          categoryFull: "Зарплата",
          kind: "income",
        }),
        tx({
          date: "2026-07-01",
          amountBase: 100,
          category: "Зарплата",
          subcategory: "Премия",
          categoryFull: "Зарплата / Премия",
          kind: "income",
        }),
        tx({
          date: "2026-07-01",
          amountBase: 10,
          category: "Еда",
          subcategory: "Кафе",
          categoryFull: "Еда / Кафе",
        }),
        tx({
          date: "2026-07-01",
          amountBase: 20,
          category: "Еда",
          subcategory: "Ресторан",
          categoryFull: "Еда / Ресторан",
        }),
        tx({
          date: "2026-07-01",
          amountBase: 30,
          category: "Ремонт",
          categoryFull: "Ремонт",
        }),
      ],
      "month",
      1
    );

  it("под плюсик уходят ровно подкатегории", () => {
    const r = report();
    const rows = buildReportSheet(r, "RUB");
    const grouped = new Set(outlineRowNumbers(r));
    expect(grouped.size).toBeGreaterThan(0);
    rows.forEach((row, i) => {
      const first = row[0];
      const isSub = !!first && first.indent === 1;
      // Отступ 1 ставится только подкатегориям — так две функции не разъедутся.
      expect(grouped.has(i + 1), `строка ${i + 1}`).toBe(isSub);
    });
  });

  it("считает строки и в блоке доходов, и в блоке расходов", () => {
    // Премия + Кафе + Ресторан.
    expect(outlineRowNumbers(report())).toHaveLength(3);
  });

  it("размечает разметку листа и ставит summaryBelow", () => {
    const xml =
      '<?xml version="1.0" ?><worksheet xmlns="x"><sheetData>' +
      '<row r="1"><c r="A1"/></row><row r="2"><c r="A2"/></row><row r="3"><c r="A3"/></row>' +
      "</sheetData></worksheet>";
    const out = addRowOutline(xml, [2]);
    expect(out).toContain('<sheetPr><outlinePr summaryBelow="0"/></sheetPr>');
    expect(out).toContain('<row r="2" outlineLevel="1">');
    expect(out).toContain('<row r="1">');
    expect(out).toContain('<row r="3">');
  });

  it("не путает строку 2 со строкой 20", () => {
    const xml = '<worksheet><sheetData><row r="2"/><row r="20"/></sheetData></worksheet>';
    const out = addRowOutline(xml, [2]);
    expect(out).toContain('<row r="2" outlineLevel="1"/>');
    expect(out).toContain('<row r="20"/>');
  });

  it("падает, если нашлись не все строки — вместо тихой выгрузки без плюсиков", () => {
    const xml = '<worksheet><sheetData><row r="1"/></sheetData></worksheet>';
    expect(() => addRowOutline(xml, [1, 99])).toThrow(/группировка строк/);
  });

  it("без подкатегорий разметку не трогает вовсе", () => {
    const xml = '<worksheet><sheetData><row r="1"/></sheetData></worksheet>';
    expect(addRowOutline(xml, [])).toBe(xml);
  });
});

describe("categoryReportXlsx — цвета строк-заголовков", () => {
  const bgOf = (row: (unknown | null)[]) =>
    (row[0] as { backgroundColor?: string } | null)?.backgroundColor;
  const rowNamed = (sheet: ReturnType<typeof buildReportSheet>, name: string) =>
    sheet.find((r) => (r[0] as { value?: string } | null)?.value === name)!;

  it("шапка серая, «Доход» зелёный, «Расход» красный, «Разница» нейтральная", () => {
    const sheet = buildReportSheet(sample(), "RUB");
    const header = bgOf(sheet[0]);
    const income = bgOf(rowNamed(sheet, "Доход"));
    const expense = bgOf(rowNamed(sheet, "Расход"));
    const net = bgOf(rowNamed(sheet, "Разница"));
    // Все заданы и различимы: шапка не совпадает ни с доходом, ни с расходом.
    for (const c of [header, income, expense, net]) expect(c).toMatch(/^#[0-9A-F]{6}$/i);
    expect(new Set([header, income, expense]).size).toBe(3);
    expect(net).toBe(header);
  });

  it("заливка покрывает всю строку, а не только название", () => {
    const sheet = buildReportSheet(sample(), "RUB");
    for (const name of ["Доход", "Расход", "Разница"]) {
      const row = rowNamed(sheet, name);
      const colors = row.map((c) => (c as { backgroundColor?: string })?.backgroundColor);
      expect(new Set(colors).size, name).toBe(1);
    }
    const headerColors = sheet[0].map(
      (c) => (c as { backgroundColor?: string })?.backgroundColor
    );
    expect(new Set(headerColors).size).toBe(1);
  });

  it("строки категорий заливки не получают", () => {
    const sheet = buildReportSheet(sample(), "RUB");
    expect(bgOf(rowNamed(sheet, "Еда"))).toBeUndefined();
  });
});

/**
 * Сквозная проверка группировки: собираем настоящий файл, распаковываем его и
 * смотрим разметку листа. Патч завязан на форму XML конкретной версии
 * `write-excel-file` — этот тест и есть тот датчик, который сработает, если
 * библиотека однажды начнёт писать строки иначе.
 */
describe("categoryReportXlsx — группировка доезжает до файла", () => {
  it("в разметке листа появляются outlineLevel и summaryBelow", async () => {
    const { default: writeXlsxFile } = await import("write-excel-file/node");
    const { unzipSync, strFromU8 } = await import("fflate");
    const report = sample();
    const buf = await writeXlsxFile(buildReportSheet(report, "RUB") as never, {
      sheet: "Доходы и расходы",
      columns: sheetColumns(report),
      stickyRowsCount: 1,
      stickyColumnsCount: 1,
    }).toBuffer();

    const zip = unzipSync(new Uint8Array(buf));
    const sheetPath = Object.keys(zip).find((n) =>
      /^xl\/worksheets\/sheet\d+\.xml$/.test(n)
    );
    expect(sheetPath, "лист не найден в архиве").toBeTruthy();

    const rows = outlineRowNumbers(report);
    expect(rows.length).toBeGreaterThan(0);
    // Не бросил — значит все ожидаемые строки нашлись в реальной разметке.
    const patched = addRowOutline(strFromU8(zip[sheetPath!]), rows);
    expect(patched).toContain('<outlinePr summaryBelow="0"/>');
    for (const n of rows) expect(patched).toContain(`<row r="${n}" outlineLevel="1"`);
  });
});
