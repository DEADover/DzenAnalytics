import { describe, it, expect } from "vitest";
import {
  CHECK_COLUMN,
  OPS_COLUMNS,
  OPS_NOTES,
  OP_TYPES,
  SHEET_DICTS,
  SHEET_HOWTO,
  SHEET_OPS,
  TEMPLATE_MARKER,
  TEMPLATE_VERSION,
  buildTemplateSheets,
  checkFormula,
  opsColumnFormats,
  opsNotes,
  opsValidations,
  type TemplateDicts,
} from "./importTemplate";
import { addRangeValidations, insertColumnFormulas, sheetRange } from "./xlsxFormulas";
import { headerName, matchHeader } from "./importRows";
import type { XlsxCell, XlsxSheet } from "./xlsxRead";

const dicts: TemplateDicts = {
  accounts: [
    { title: "Наличные", currency: "RUB", kind: "Наличные" },
    { title: "Т-Банк", currency: "RUB", kind: "Карта" },
    { title: "FFin $", currency: "USD", kind: "Карта" },
  ],
  categories: ["Еда / Кафе", "Еда / Продукты", "Транспорт"],
  payees: ["Пятёрочка", "Ozon"],
  base: "RUB",
};

const sheetOf = (name: string) =>
  buildTemplateSheets(dicts, "2026-08-17").find((s) => s.sheet === name)!;

const textAt = (rows: { value?: string | number | null }[][], r: number, c: number) =>
  String(rows[r]?.[c]?.value ?? "");

describe("buildTemplateSheets — состав книги", () => {
  it("четыре листа в понятном порядке", () => {
    expect(buildTemplateSheets(dicts, "2026-08-17").map((s) => s.sheet)).toEqual([
      "Операции",
      "Справочники",
      "Примеры",
      "Как заполнять",
    ]);
  });

  it("КЛЮЧЕВОЕ: шапка — это только названия колонок", () => {
    // Приписка «(расход, перевод)» в названии лезла за ширину колонки и рвала
    // договор с разбором. Подсказки живут заметками на тех же ячейках.
    const head = sheetOf(SHEET_OPS).data[0].map((c) => String(c.value));
    expect(head).toEqual([...OPS_COLUMNS, CHECK_COLUMN]);
  });

  it("КЛЮЧЕВОЕ: разбор находит все колонки в нашей же шапке", () => {
    const cells = new Map<string, XlsxCell>();
    sheetOf(SHEET_OPS).data[0].forEach((c, i) => {
      cells.set(`${String.fromCharCode(65 + i)}1`, { kind: "text", text: String(c.value ?? "") });
    });
    const { columns, missing } = matchHeader({ cells, lastRow: 1, date1904: false } as XlsxSheet);
    expect(missing).toEqual([]);
    expect(columns.get("Счёт зачисления")).toBe("F");
  });

  it("на каждой ячейке шапки висит заметка — и на «Проверке» тоже", () => {
    const notes = opsNotes();
    expect(notes.map((n) => n.ref)).toEqual([
      "A1", "B1", "C1", "D1", "E1", "F1", "G1", "H1", "I1", "J1", "K1",
    ]);
    expect(notes.map((n) => n.title)).toEqual([...OPS_COLUMNS, CHECK_COLUMN]);
    for (const n of notes) expect(n.text.length).toBeGreaterThan(20);
  });

  it("заметки говорят, для каких типов операций колонка", () => {
    expect(OPS_NOTES["Счёт списания"]).toContain("расхода и у перевода");
    expect(OPS_NOTES["Счёт зачисления"]).toContain("дохода, возврата и перевода");
    expect(OPS_NOTES.Категория).toContain("У перевода категории нет");
    expect(OPS_NOTES.Сумма).toContain("Всегда положительная");
  });

  it("колонки дат и сумм оформлены на будущее — под ввод человека", () => {
    // Ячеек под данные ещё нет: оформление достанется им от колонки.
    const f = opsColumnFormats();
    expect(f[0]).toMatchObject({ column: 1, numFmt: "DD.MM.YYYY", align: "center" });
    expect(f[6]).toMatchObject({ column: 7, numFmt: "#,##0.00", align: "right" });
    expect(f).toHaveLength(OPS_COLUMNS.length + 1);
  });

  it("КЛЮЧЕВОЕ: название колонки помещается в её ширину", () => {
    // Ровно та жалоба, из-за которой подсказки уехали в заметки: текст шапки
    // не влезал и разъезжался по соседним колонкам.
    const sheet = sheetOf(SHEET_OPS);
    sheet.data[0].forEach((cell, i) => {
      const name = String(cell.value ?? "");
      expect(sheet.columns[i].width).toBeGreaterThanOrEqual(name.length + 1);
    });
  });

  it("ширина колонки со справочником считается по самому длинному значению", () => {
    // «Интернет-покупки / Подписки» — обычная длина реальной категории.
    const wide = buildTemplateSheets(
      { ...dicts, categories: ["Интернет-покупки / Подписки"] },
      "2026-08-17"
    ).find((s) => s.sheet === SHEET_OPS)!;
    expect(wide.columns[3].width).toBeGreaterThan(sheetOf(SHEET_OPS).columns[3].width);
  });

  it("под шапкой на листе данных пусто — это место человека", () => {
    expect(sheetOf(SHEET_OPS).data).toHaveLength(1);
  });


  it("справочники — живые: счета с валютой, категории путями, контрагенты", () => {
    const rows = sheetOf(SHEET_DICTS).data;
    expect(rows[0].map((c) => c.value)).toEqual([
      "Счета",
      "Валюта",
      "Вид",
      "Категории",
      "Контрагенты",
      "Типы операций",
    ]);
    expect(textAt(rows, 1, 0)).toBe("Наличные");
    expect(textAt(rows, 1, 1)).toBe("RUB");
    expect(textAt(rows, 3, 0)).toBe("FFin $");
    expect(textAt(rows, 1, 3)).toBe("Еда / Кафе");
    expect(textAt(rows, 2, 4)).toBe("Ozon");
    // Типы операций — те же слова, что понимает разбор.
    expect(rows.slice(1, 1 + OP_TYPES.length).map((r) => r[5].value)).toEqual([...OP_TYPES]);
  });

  it("справочник не обрывается по самому короткому столбцу", () => {
    // Счетов три, контрагентов два, категорий три — строк должно хватить всем.
    const rows = sheetOf(SHEET_DICTS).data;
    expect(rows).toHaveLength(1 + Math.max(3, 3, 2, OP_TYPES.length));
  });

  it("на листе-инструкции всё слева и по центру строки", () => {
    // Строки там разной высоты: длинное правило переносится на две-три. При
    // выравнивании по низу номер пункта оказывался под своим текстом.
    for (const row of sheetOf(SHEET_HOWTO).data) {
      for (const cell of row) {
        expect(cell.align).toBe("left");
        expect(cell.alignVertical).toBe("center");
      }
    }
  });

  it("маркер, версия и дата выгрузки лежат в известных ячейках", () => {
    const rows = sheetOf(SHEET_HOWTO).data;
    expect(textAt(rows, 1, 0)).toBe(TEMPLATE_MARKER);
    expect(rows[2][1].value).toBe(TEMPLATE_VERSION);
    expect(textAt(rows, 3, 1)).toBe("2026-08-17");
    expect(textAt(rows, 4, 1)).toBe("RUB");
  });

  it("в примерах есть все четыре типа и перевод между валютами", () => {
    const rows = buildTemplateSheets(dicts, "2026-08-17")
      .find((s) => s.sheet === "Примеры")!
      .data.slice(1);
    expect(rows.map((r) => r[2].value)).toEqual([
      "Расход",
      "Доход",
      "Возврат",
      "Перевод",
      "Перевод",
    ]);
    // У последнего примера заполнена «Сумма зачисления» — та самая колонка,
    // без которой перевод между валютами не собирается.
    expect(rows[4][7].value).toBe(9500);
  });
});

describe("opsValidations — выпадающие списки", () => {
  it("списки ссылаются на справочник, а не на константу", () => {
    const v = opsValidations(dicts);
    expect(v.find((x) => x.sqref.startsWith("E"))?.range).toBe(
      sheetRange(SHEET_DICTS, "$A$2", "$A$4")
    );
    expect(v.find((x) => x.sqref.startsWith("D"))?.range).toBe(
      sheetRange(SHEET_DICTS, "$D$2", "$D$4")
    );
  });

  it("КЛЮЧЕВОЕ: у контрагента проверка мягкая, у остальных жёсткая", () => {
    // Нового контрагента вписать законно; счёт или категорию вне справочника
    // Дзен-мани всё равно не примет — и честнее сказать об этом сразу в Excel.
    const v = opsValidations(dicts);
    expect(v.find((x) => x.sqref.startsWith("I"))?.hard).toBe(false);
    for (const col of ["C", "D", "E", "F"]) {
      expect(v.find((x) => x.sqref.startsWith(col))?.hard).not.toBe(false);
    }
  });

  it("пустой справочник не даёт перевёрнутый диапазон", () => {
    // «$E$2:$E$1» Excel считает битой книгой и предлагает её восстановить.
    const empty = opsValidations({ ...dicts, payees: [] });
    expect(empty.find((x) => x.sqref.startsWith("I"))?.range).toBe(
      sheetRange(SHEET_DICTS, "$E$2", "$E$2")
    );
  });
});

describe("разметка валидаций в листе", () => {
  it("узел встаёт перед концом листа и не ломает разметку", () => {
    const xml = addRangeValidations("<worksheet><sheetData/></worksheet>", opsValidations(dicts));
    expect(xml.indexOf("<dataValidations")).toBeGreaterThan(xml.indexOf("<sheetData"));
    expect(xml.indexOf("</dataValidations>")).toBeLessThan(xml.indexOf("</worksheet>"));
    expect(xml.match(/<dataValidation /g)).toHaveLength(5);
    expect(xml).toContain('showErrorMessage="0"');
  });

  it("имя листа с пробелом берётся в апострофы", () => {
    expect(sheetRange("Как заполнять", "$A$1", "$A$9")).toBe("'Как заполнять'!$A$1:$A$9");
    expect(sheetRange("Справочники", "$A$1", "$A$9")).toBe("Справочники!$A$1:$A$9");
  });
});

describe("headerName — снисходительность к чужой шапке", () => {
  it("своя приписка в скобках не мешает найти колонку", () => {
    // Человек имеет право дописать себе «Сумма (руб)» — договор в названии.
    expect(headerName("Сумма (руб)")).toBe("Сумма");
    expect(headerName("Дата")).toBe("Дата");
  });
});

describe("checkFormula — проверка прямо в файле", () => {
  const f = checkFormula(7);

  it("КЛЮЧЕВОЕ: пустая строка молчит, заполненная получает вердикт", () => {
    // Иначе тысяча пустых строк шаблона встретила бы человека тысячей ошибок.
    expect(f.startsWith('IF(COUNTA(A7:J7)=0,"",')).toBe(true);
    expect(f).toContain('"Готово"');
  });

  it("ловит то же, что и разбор при загрузке", () => {
    expect(f).toContain('"У перевода категория не заполняется"');
    expect(f).toContain('"У расхода счёт зачисления не заполняется"');
    expect(f).toContain('"Нужен счёт зачисления"');
    expect(f).toContain('"Сумма пишется без минуса"');
    expect(f).toContain('"Перевод на тот же счёт"');
  });

  it("тип сверяется со справочником, а не со списком в формуле", () => {
    // Список типов лежит на листе «Справочники» — там же, где выпадашка.
    expect(f).toContain(`COUNTIF(${sheetRange(SHEET_DICTS, "$F$2", `$F$${OP_TYPES.length + 1}`)},C7)=0`);
  });

  it("скобки сходятся — иначе Excel считает файл битым", () => {
    const open = (f.match(/\(/g) ?? []).length;
    const close = (f.match(/\)/g) ?? []).length;
    expect(open).toBe(close);
  });

  it("формула доезжает до листа целой строкой на каждую строку данных", () => {
    const sheet = "<worksheet><sheetData>" +
      '<row r="1"><c r="A1" t="s"><v>0</v></c></row>' +
      "</sheetData></worksheet>";
    const out = insertColumnFormulas(sheet, {
      column: "K",
      from: 2,
      to: 4,
      formula: checkFormula,
    });
    expect(out).toContain('<c r="K2" t="str">');
    expect(out).toContain('<c r="K4" t="str">');
    // Кавычки и знаки сравнения обязаны уехать экранированными.
    expect(out).toContain("&quot;Готово&quot;");
    expect(out).not.toMatch(/<f>[^<]*[^&]<[^/]/);
  });
});
