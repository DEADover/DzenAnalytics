import { describe, it, expect } from "vitest";
import {
  CHECK_COLUMN,
  OPS_COLUMNS,
  OPS_HINTS,
  OP_TYPES,
  SHEET_DICTS,
  SHEET_HOWTO,
  SHEET_OPS,
  TEMPLATE_MARKER,
  TEMPLATE_VERSION,
  buildTemplateSheets,
  checkFormula,
  opsHeader,
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

  it("КЛЮЧЕВОЕ: в колонках данных на листе «Операции» пусто", () => {
    // Строка-пример внутри данных — это операция, которую кто-нибудь забудет
    // удалить и отправит в облако. Примеры живут отдельным листом, а памятка
    // справа от данных: её колонки разбор не читает.
    const ops = sheetOf(SHEET_OPS).data;
    for (const row of ops.slice(1)) {
      expect(row.slice(0, OPS_COLUMNS.length).map((c) => c.value)).toEqual(
        OPS_COLUMNS.map(() => "")
      );
    }
  });

  it("шапка говорит, какая колонка для каких типов операций", () => {
    // Половина отбитых строк — это «Счёт списания» вместо «Счёт зачисления»:
    // рядом они одинаково убедительны, пока не сказано иначе.
    const head = sheetOf(SHEET_OPS).data[0].map((c) => String(c.value));
    expect(head).toContain("Счёт списания (расход, перевод)");
    expect(head).toContain("Счёт зачисления (доход, возврат, перевод)");
    expect(head).toContain("Категория (кроме перевода)");
    expect(head[OPS_COLUMNS.length]).toBe(CHECK_COLUMN);
  });

  it("КЛЮЧЕВОЕ: приписка в шапке не мешает разбору найти колонку", () => {
    // Приписка — украшение файла, договор остаётся в самом названии. Иначе
    // шаблон с подсказками не прочитался бы нашим же разбором.
    const cells = new Map<string, XlsxCell>();
    sheetOf(SHEET_OPS).data[0].forEach((c, i) => {
      cells.set(`${String.fromCharCode(65 + i)}1`, { kind: "text", text: String(c.value ?? "") });
    });
    const { columns, missing } = matchHeader({ cells, lastRow: 1, date1904: false } as XlsxSheet);
    expect(missing).toEqual([]);
    expect(columns.get("Счёт зачисления")).toBe("F");
  });

  it("памятка лежит справа от данных, на том же листе", () => {
    const ops = sheetOf(SHEET_OPS).data;
    const notes = ops.slice(1).map((r) => String(r[12]?.value ?? ""));
    expect(notes.length).toBeGreaterThan(5);
    expect(notes.join(" ")).toContain("Перевод — оба счёта");
    expect(notes.join(" ")).toContain("Сумма всегда положительная");
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

describe("opsHeader и headerName — приписки в шапке", () => {
  it("каждая колонка с припиской читается обратно в своё название", () => {
    for (const col of OPS_COLUMNS) expect(headerName(opsHeader(col))).toBe(col);
  });

  it("колонка без приписки остаётся как была", () => {
    expect(OPS_HINTS.Дата).toBeUndefined();
    expect(opsHeader("Дата")).toBe("Дата");
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
