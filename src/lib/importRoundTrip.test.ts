import { describe, it, expect } from "vitest";
import type { ZenCache } from "./zenmoneyCache";
import {
  buildTemplateSheets,
  patchTemplateBook,
  SHEET_OPS,
  OPS_COLUMNS,
  TEMPLATE_ROWS,
} from "./importTemplate";
import { readXlsxSheet } from "./xlsxRead";
import { buildImportPlan, isBlankRow, matchHeader, readRow } from "./importRows";

/**
 * Сквозная проверка: шаблон → заполненный файл → операции.
 *
 * Каждый слой проверен своими тестами, но между ними есть швы, на которых
 * ошибка не видна ни одному из них: имя листа в шаблоне и имя листа при чтении,
 * порядок колонок при записи и поиск колонок по шапке, формат даты у писателя и
 * разбор даты у читателя. Здесь книга записывается НАСТОЯЩИМ писателем и
 * читается НАШИМ ридером — ровно тот путь, что проходит файл пользователя.
 */

const RUB = 2;

const cache = (): ZenCache =>
  ({
    serverTimestamp: 0,
    instruments: [{ id: RUB, shortTitle: "RUB", rate: 1 }],
    accounts: [
      { id: "acc-cash", title: "Наличные", instrument: RUB, archive: false, type: "cash" },
      { id: "acc-card", title: "Т-Банк", instrument: RUB, archive: false, type: "ccard" },
    ],
    tags: [
      { id: "t-food", title: "Еда", parent: null, archive: false, showIncome: false },
      { id: "t-cafe", title: "Кафе", parent: "t-food", archive: false, showIncome: false },
      { id: "t-salary", title: "Зарплата", parent: null, archive: false, showIncome: true },
    ],
    merchants: [{ id: "m-pyat", title: "Пятёрочка" }],
    transactions: [],
    user: [{ id: 99, currency: RUB }],
  }) as unknown as ZenCache;

const dicts = {
  accounts: ["Наличные", "Т-Банк"],
  categories: ["Еда", "Еда / Кафе", "Зарплата"],
  payees: ["Пятёрочка"],
};

/** Ячейка так, как её записывает генератор шаблона. */
const text = (value: string) => ({ value, type: String });
const num = (value: number) => ({ value, type: Number });

/**
 * Записать книгу тем же пакетом, что и кнопка «Скачать шаблон», дописав к листу
 * «Операции» строки пользователя.
 */
async function fillTemplate(rows: unknown[][]): Promise<ArrayBuffer> {
  const sheets = buildTemplateSheets(
    { accounts: dicts.accounts.map((t) => ({ title: t, currency: "RUB", kind: "Карта" })), categories: dicts.categories, payees: dicts.payees, base: "RUB" },
    "2026-08-18"
  );
  const filled = sheets.map((s) =>
    s.sheet === SHEET_OPS ? { ...s, data: [...s.data, ...(rows as never[])] } : s
  );
  const { default: writeXlsxFile } = await import("write-excel-file/node");
  // Пакет отдаёт не буфер, а объект с `toBuffer()` — как и в браузере, где
  // берут `toBlob()`.
  const buffer = await writeXlsxFile(filled as never).toBuffer();
  const bytes = new Uint8Array(buffer as unknown as ArrayBufferLike);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Прочитать книгу так же, как это делает карточка импорта. */
async function planOf(buf: ArrayBuffer) {
  const sheet = await readXlsxSheet(buf, SHEET_OPS);
  const { columns, missing } = matchHeader(sheet);
  expect(missing).toEqual([]);
  const rows = [];
  for (let r = 2; r <= sheet.lastRow; r++) {
    const row = readRow(sheet, columns, r);
    if (!isBlankRow(row)) rows.push(row);
  }
  return buildImportPlan(rows, dicts, cache(), [], 1_700_000_000, () => `d${rows.length}`);
}

describe("шаблон → файл → операции", () => {
  it("КЛЮЧЕВОЕ: заполненный шаблон доезжает до готовых операций", async () => {
    const plan = await planOf(
      await fillTemplate([
        [text("17.08.2026"), text("09:30"), text("Расход"), text("Еда / Кафе"), text("Т-Банк"), text(""), num(1290.5), text(""), text("Пятёрочка"), text("Обед")],
        [text("17.08.2026"), text(""), text("Доход"), text("Зарплата"), text(""), text("Т-Банк"), num(120000), text(""), text(""), text("")],
        [text("18.08.2026"), text(""), text("Перевод"), text(""), text("Т-Банк"), text("Наличные"), num(5000), text(""), text(""), text("Снял наличные")],
      ])
    );
    expect(plan).toMatchObject({ ready: 3, failed: 0, duplicates: 0 });
    const [expense, income, transfer] = plan.rows.map((r) => (r.verdict.ok ? r.verdict.zen : null));
    expect(expense).toMatchObject({ outcome: 1290.5, income: 0, tag: ["t-cafe"], merchant: "m-pyat" });
    expect(income).toMatchObject({ income: 120000, outcome: 0, tag: ["t-salary"] });
    expect(transfer).toMatchObject({
      outcomeAccount: "acc-card",
      incomeAccount: "acc-cash",
      outcome: 5000,
      income: 5000,
    });
  });

  it("дата, записанная НАСТОЯЩЕЙ датой Excel, читается правильно", async () => {
    // Самый вероятный способ заполнить шаблон: набрать дату в ячейке и дать
    // Excel сделать из неё число. Промах в эпохе сдвинул бы все операции.
    const plan = await planOf(
      await fillTemplate([
        [
          { value: new Date(Date.UTC(2026, 7, 17)), type: Date, format: "dd.mm.yyyy" },
          text(""),
          text("Расход"),
          text("Еда"),
          text("Наличные"),
          text(""),
          num(100),
          text(""),
          text(""),
          text(""),
        ],
      ])
    );
    expect(plan.ready).toBe(1);
    expect(plan.rows[0].date).toBe("2026-08-17");
  });

  it("ошибочная строка не мешает соседним", async () => {
    const plan = await planOf(
      await fillTemplate([
        [text("17.08.2026"), text(""), text("Расход"), text("Еда"), text("Наличные"), text(""), num(100), text(""), text(""), text("")],
        [text("17.08.2026"), text(""), text("Расход"), text("Небо"), text("Наличные"), text(""), num(200), text(""), text(""), text("")],
        [text("17.08.2026"), text(""), text("Расход"), text("Еда"), text("Наличные"), text(""), num(-300), text(""), text(""), text("")],
      ])
    );
    expect(plan).toMatchObject({ ready: 1, failed: 2 });
    expect(plan.rows[1].verdict).toMatchObject({ ok: false });
    expect(plan.rows[2].verdict).toMatchObject({ ok: false });
  });

  it("КЛЮЧЕВОЕ: незнакомый контрагент в файле — не ошибка, а новая запись", async () => {
    // Мягкая проверка в Excel на колонке «Контрагент» именно для этого: имя
    // можно вписать своё, а справочник мы пополним сами.
    const plan = await planOf(
      await fillTemplate([
        [text("17.08.2026"), text(""), text("Расход"), text("Еда"), text("Наличные"), text(""), num(100), text(""), text("Ларёк у дома"), text("")],
      ])
    );
    expect(plan.ready).toBe(1);
    const v = plan.rows[0].verdict;
    expect(v.ok && v.newCounterparty?.title).toBe("Ларёк у дома");
    expect(plan.newCounterparties).toHaveLength(1);
    expect(v.ok && v.zen.merchant).toBe(plan.newCounterparties[0].id);
  });

  it("пустые строки между данными не считаются ошибкой", async () => {
    const plan = await planOf(
      await fillTemplate([
        [text("17.08.2026"), text(""), text("Расход"), text("Еда"), text("Наличные"), text(""), num(100), text(""), text(""), text("")],
        OPS_COLUMNS.map(() => text("")),
        [text("18.08.2026"), text(""), text("Расход"), text("Еда"), text("Наличные"), text(""), num(200), text(""), text(""), text("")],
      ])
    );
    expect(plan).toMatchObject({ ready: 2, failed: 0 });
  });
});

describe("шаблон как файл", () => {
  /** Книга ровно в том виде, в каком её скачивает человек. */
  async function templateBytes(): Promise<Uint8Array> {
    const sheets = buildTemplateSheets(
      {
        accounts: dicts.accounts.map((t) => ({ title: t, currency: "RUB", kind: "Карта" })),
        categories: dicts.categories,
        payees: dicts.payees,
        base: "RUB",
      },
      "2026-08-18"
    );
    const { default: writeXlsxFile } = await import("write-excel-file/node");
    const buffer = await writeXlsxFile(sheets as never).toBuffer();
    return patchTemplateBook(new Uint8Array(buffer as unknown as ArrayBufferLike), {
      accounts: dicts.accounts.map((t) => ({ title: t, currency: "RUB", kind: "Карта" })),
      categories: dicts.categories,
      payees: dicts.payees,
      base: "RUB",
    });
  }

  it("КЛЮЧЕВОЕ: скачанный шаблон читается нашим же разбором", async () => {
    // Шапка с приписками, памятка справа, тысяча строк формул — всё это легко
    // ломает чтение, а заметно будет только у человека.
    const bytes = await templateBytes();
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const sheet = await readXlsxSheet(buf, SHEET_OPS);
    const { columns, missing } = matchHeader(sheet);
    expect(missing).toEqual([]);
    expect(columns.get("Счёт списания")).toBe("E");
    // Ни одной строки данных: памятка стоит в колонках, которых разбор не знает.
    for (let r = 2; r <= Math.min(sheet.lastRow, 40); r++) {
      expect(isBlankRow(readRow(sheet, columns, r))).toBe(true);
    }
  });

  it("формула проверки стоит на всех строках и файл не разбухает", async () => {
    const bytes = await templateBytes();
    const { unzipSync, strFromU8 } = await import("fflate");
    const zip = unzipSync(bytes);
    const xml = strFromU8(zip["xl/worksheets/sheet1.xml"]);
    // Текст формулы написан один раз, остальные строки ссылаются на него.
    expect(xml).toContain(`<f t="shared" ref="K2:K${TEMPLATE_ROWS + 1}" si="0">`);
    expect(xml).toContain(`<c r="K${TEMPLATE_ROWS + 1}" t="str"><f t="shared" si="0"/></c>`);
    // Памятка занимает первые строки — формула обязана встать и рядом с ней.
    expect(xml).toContain('<c r="K5" t="str"><f t="shared" si="0"/></c>');
    expect(xml).toContain("dataValidation");
    // Шаблон качают по кнопке: развёрнутая формула на каждой из тысячи строк
    // весила бы сотню килобайт при полезной нагрузке в семь.
    expect(bytes.length).toBeLessThan(30_000);
  });
});
