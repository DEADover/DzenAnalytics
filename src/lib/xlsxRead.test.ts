import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  cellNumber,
  cellText,
  colOf,
  looksLikeZip,
  readXlsxSheet,
  rowOf,
  serialToParts,
} from "./xlsxRead";

/**
 * Книга собирается здесь руками, а не библиотекой записи.
 *
 * Так тест проверяет ровно то, ради чего ридер написан: разбор чужого файла со
 * всеми его особенностями — общей таблицей строк, рунами, встроенным текстом,
 * пропущенными ячейками. Файл, записанный нашей же библиотекой, этих случаев не
 * содержит и проверил бы только сам себя.
 */
function book(opts: {
  sheetXml: string;
  shared?: string;
  date1904?: boolean;
  sheetName?: string;
}): ArrayBuffer {
  const name = opts.sheetName ?? "Операции";
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8("<Types/>"),
    "xl/workbook.xml": strToU8(
      `<workbook>${opts.date1904 ? '<workbookPr date1904="1"/>' : ""}` +
        `<sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'
    ),
    "xl/worksheets/sheet1.xml": strToU8(opts.sheetXml),
  };
  if (opts.shared) files["xl/sharedStrings.xml"] = strToU8(opts.shared);
  const zipped = zipSync(files);
  return zipped.buffer.slice(
    zipped.byteOffset,
    zipped.byteOffset + zipped.byteLength
  ) as ArrayBuffer;
}

const sheet = (rows: string) =>
  `<worksheet><sheetData>${rows}</sheetData></worksheet>`;

describe("readXlsxSheet — чтение чужого файла", () => {
  it("КЛЮЧЕВОЕ: ячейки читаются по адресу, а не по порядку", async () => {
    // Пустых ячеек в файле нет вовсе: у строки есть A и C, но не B. Счёт по
    // порядку сдвинул бы «правее» на колонку влево — классическая поломка
    // самописных читалок, из-за которой сумма попадает в поле категории.
    const s = await readXlsxSheet(
      book({
        sheetXml: sheet(
          '<row r="1"><c r="A1" t="inlineStr"><is><t>левее</t></is></c>' +
            '<c r="C1" t="inlineStr"><is><t>правее</t></is></c></row>'
        ),
      }),
      "Операции"
    );
    expect(cellText(s, "A1")).toBe("левее");
    expect(cellText(s, "B1")).toBe("");
    expect(cellText(s, "C1")).toBe("правее");
  });

  it("общая таблица строк и руны склеиваются в одну строку", async () => {
    const s = await readXlsxSheet(
      book({
        shared:
          "<sst>" +
          "<si><t>Еда / Кафе</t></si>" +
          "<si><r><t>Пятё</t></r><r><t>рочка</t></r></si>" +
          "</sst>",
        sheetXml: sheet(
          '<row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2" t="s"><v>1</v></c></row>'
        ),
      }),
      "Операции"
    );
    expect(cellText(s, "A2")).toBe("Еда / Кафе");
    expect(cellText(s, "B2")).toBe("Пятёрочка");
  });

  it("числа остаются числами, а формулы отдают посчитанное значение", async () => {
    const s = await readXlsxSheet(
      book({
        sheetXml: sheet(
          '<row r="3"><c r="A3"><v>1234.56</v></c>' +
            '<c r="B3" t="str"><f>CONCAT(1,2)</f><v>12</v></c></row>'
        ),
      }),
      "Операции"
    );
    expect(cellNumber(s, "A3")).toBe(1234.56);
    expect(cellText(s, "A3")).toBe("1234.56");
    expect(cellText(s, "B3")).toBe("12");
    expect(cellNumber(s, "B3")).toBeNull();
  });

  it("ошибка формулы читается как пустая ячейка", async () => {
    const s = await readXlsxSheet(
      book({ sheetXml: sheet('<row r="4"><c r="A4" t="e"><v>#REF!</v></c></row>') }),
      "Операции"
    );
    expect(cellText(s, "A4")).toBe("");
  });

  it("сущности XML разворачиваются обратно", async () => {
    const s = await readXlsxSheet(
      book({
        sheetXml: sheet(
          '<row r="5"><c r="A5" t="inlineStr"><is><t>Кафе &amp;amp; бар &#x2014; «Мы»</t></is></c></row>'
        ),
      }),
      "Операции"
    );
    // «&amp;amp;» — это буквальный «&amp;» в тексте ячейки: разворачиваем ровно
    // один уровень, иначе текст пользователя молча менялся бы.
    expect(cellText(s, "A5")).toBe("Кафе &amp; бар — «Мы»");
  });

  it("последняя строка считается по данным, а не по разметке", async () => {
    const s = await readXlsxSheet(
      book({
        sheetXml: sheet(
          '<row r="1"><c r="A1"><v>1</v></c></row><row r="7"><c r="A7"><v>2</v></c></row>'
        ),
      }),
      "Операции"
    );
    expect(s.lastRow).toBe(7);
  });

  it("лист ищется по имени, а не «первый попавшийся»", async () => {
    const buf = book({ sheetXml: sheet(""), sheetName: "Справочники" });
    await expect(readXlsxSheet(buf, "Операции")).rejects.toThrow(/Операции/);
    await expect(readXlsxSheet(buf, "Справочники")).resolves.toBeTruthy();
  });

  it("не-zip отбивается человеческой фразой, а не разбором", async () => {
    const xls = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4]);
    await expect(
      readXlsxSheet(
        xls.buffer.slice(0, 8) as ArrayBuffer,
        "Операции"
      )
    ).rejects.toThrow(/\.xlsx/);
  });
});

describe("looksLikeZip — отличаем .xlsx от .xls", () => {
  it("старый бинарный .xls не проходит", () => {
    expect(looksLikeZip(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]).buffer)).toBe(false);
  });

  it("архив проходит", () => {
    expect(looksLikeZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer)).toBe(true);
  });
});

describe("serialToParts — серийная дата Excel", () => {
  it("КЛЮЧЕВОЕ: эпоха 1899-12-30, а не 1900-01-01", () => {
    // Excel считает 1900-й високосным; сдвиг на два дня встроен в эпоху.
    // 45000 — это 15 марта 2023-го, и промах здесь сдвинул бы ВСЕ даты импорта.
    expect(serialToParts(45000)).toMatchObject({ y: 2023, m: 3, d: 15 });
    expect(serialToParts(1)).toMatchObject({ y: 1899, m: 12, d: 31 });
  });

  it("дробная часть — это время", () => {
    expect(serialToParts(45000.5)).toMatchObject({ hh: 12, mm: 0 });
    expect(serialToParts(45000.25)).toMatchObject({ hh: 6, mm: 0 });
    expect(serialToParts(45000)).toMatchObject({ hh: 0, mm: 0 });
  });

  it("система дат 1904 считается от своей эпохи", () => {
    expect(serialToParts(45000, true)).toMatchObject({ y: 2027, m: 3, d: 16 });
  });

  it("почти-полночь не переливается в 24 часа", () => {
    expect(serialToParts(45000.99999)).toMatchObject({ hh: 23, mm: 59 });
  });
});

describe("адреса ячеек", () => {
  it("колонка и строка разбираются, в том числе двухбуквенные", () => {
    expect(colOf("B7")).toBe("B");
    expect(rowOf("B7")).toBe(7);
    expect(colOf("AB123")).toBe("AB");
    expect(rowOf("AB123")).toBe(123);
  });
});
