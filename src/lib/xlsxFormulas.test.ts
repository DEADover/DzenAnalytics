import { describe, it, expect } from "vitest";
import {
  addListValidation,
  cellRef,
  forceRecalc,
  insertColumnFormulas,
  setFormulas,
} from "./xlsxFormulas";

/** Кусок листа с тремя ячейками: числовой, строковой и самозакрывающейся. */
const SHEET =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  "<sheetData>" +
  '<row r="1"><c r="A1" s="2" t="s"><v>0</v></c><c r="B1" s="3"><v>1200</v></c></row>' +
  '<row r="2"><c r="A2" s="2"/><c r="B2" s="3"><v>50</v></c></row>' +
  "</sheetData></worksheet>";

describe("cellRef", () => {
  it("складывает адрес из колонки и строки", () => {
    expect(cellRef(0, 1)).toBe("A1");
    expect(cellRef(25, 12)).toBe("Z12");
    expect(cellRef(26, 3)).toBe("AA3");
    expect(cellRef(45, 7)).toBe("AT7");
  });
});

describe("setFormulas", () => {
  it("вписывает формулу и сохраняет посчитанное значение кэшем", () => {
    // Кэш нужен для программ, которые формул не считают: Preview, вьюеры почты.
    const out = setFormulas(SHEET, new Map([["B1", "INDEX($J1:$U1,Дашборд!$P$2)"]]));
    expect(out).toContain("<f>INDEX($J1:$U1,Дашборд!$P$2)</f>");
    expect(out).toContain("<f>INDEX($J1:$U1,Дашборд!$P$2)</f><v>1200</v>");
  });

  it("сохраняет оформление ячейки", () => {
    const out = setFormulas(SHEET, new Map([["B1", "1+1"]]));
    expect(out).toContain('<c r="B1" s="3">');
  });

  it("снимает тип строки: результат формулы в таблицу строк не попадает", () => {
    const out = setFormulas(SHEET, new Map([["A1", '""']]));
    expect(out).toContain('<c r="A1" s="2">');
    expect(out).not.toContain('t="s"');
  });

  it("работает и с самозакрывающейся пустой ячейкой", () => {
    const out = setFormulas(SHEET, new Map([["A2", "SUM(B1:B2)"]]));
    expect(out).toContain('<c r="A2" s="2"><f>SUM(B1:B2)</f></c>');
  });

  it("экранирует символы XML в формуле", () => {
    // `<`, `>` и `&` в формуле — обычное дело: «IF(A1>0,...)».
    const out = setFormulas(SHEET, new Map([["B1", 'IF(B2>0,"да","нет")']]));
    expect(out).toContain("IF(B2&gt;0,&quot;да&quot;,&quot;нет&quot;)");
    expect(out).not.toContain('<f>IF(B2>0');
  });

  it("падает, если ячейки на листе нет", () => {
    // Молча выгруженный отчёт с мёртвой выпадашкой хуже честной ошибки.
    expect(() => setFormulas(SHEET, new Map([["Z9", "1"]]))).toThrow(/не найдены/);
  });

  it("без формул отдаёт лист как есть", () => {
    expect(setFormulas(SHEET, new Map())).toBe(SHEET);
  });

  it("не трогает соседние ячейки", () => {
    const out = setFormulas(SHEET, new Map([["B1", "1"]]));
    expect(out).toContain('<c r="B2" s="3"><v>50</v></c>');
  });
});

describe("addListValidation", () => {
  it("добавляет выпадающий список в конец листа", () => {
    const out = addListValidation(SHEET, "P1", ["Январь", "Февраль"]);
    expect(out).toContain('sqref="P1"');
    expect(out).toContain("&quot;Январь,Февраль&quot;");
    expect(out).toMatch(/<\/dataValidations><\/worksheet>$/);
  });

  it("встаёт ПЕРЕД рисунком — по схеме он последний", () => {
    const withDrawing = SHEET.replace("</worksheet>", '<drawing r:id="rId1"/></worksheet>');
    const out = addListValidation(withDrawing, "P1", ["Январь"]);
    expect(out.indexOf("<dataValidations")).toBeLessThan(out.indexOf("<drawing "));
  });

  it("падает на списке длиннее лимита Excel", () => {
    // Молча обрезанный список Excel считает битым файлом.
    const long = Array.from({ length: 40 }, (_, i) => `Вариант ${i}`);
    expect(() => addListValidation(SHEET, "A1", long)).toThrow(/лимит/);
  });
});

describe("forceRecalc", () => {
  const WB =
    '<?xml version="1.0"?><workbook><sheets><sheet name="Лист" sheetId="1"/></sheets></workbook>';

  it("просит Excel пересчитать книгу при открытии", () => {
    // Наш кэш пришёл от генератора, а не от Excel; без флага он верит кэшу.
    expect(forceRecalc(WB)).toContain('fullCalcOnLoad="1"');
    expect(forceRecalc(WB)).toMatch(/<calcPr[^>]*\/><\/workbook>$/);
  });

  it("заменяет уже существующий calcPr, а не дублирует его", () => {
    const withCalc = WB.replace("</workbook>", '<calcPr calcId="191029"/></workbook>');
    const out = forceRecalc(withCalc);
    expect(out.match(/<calcPr/g)).toHaveLength(1);
    expect(out).toContain('fullCalcOnLoad="1"');
  });
});

describe("insertColumnFormulas — столбец проверки на пустой лист", () => {
  const sheet = (rows: string) =>
    '<worksheet><sheetData>' + rows + "</sheetData></worksheet>";

  it("КЛЮЧЕВОЕ: строк ещё нет — они создаются, чтобы формула ждала ввода", () => {
    // Проверка нужна ЗАРАНЕЕ: человек вводит строку и сразу видит, что не так.
    // `setFormulas` тут не подходит — он требует существующей ячейки.
    const out = insertColumnFormulas(sheet('<row r="1"><c r="A1" t="s"><v>0</v></c></row>'), {
      column: "K",
      from: 2,
      to: 4,
      formula: (r) => `IF(A${r}="","","Готово")`,
    });
    expect(out).toContain('<row r="2"><c r="K2" t="str"><f>IF(A2=&quot;&quot;,&quot;&quot;,&quot;Готово&quot;)</f></c></row>');
    expect(out.match(/<row r="\d+"/g)).toEqual(['<row r="1"', '<row r="2"', '<row r="3"', '<row r="4"']);
  });

  it("в существующей строке ячейка встаёт по порядку колонок", () => {
    // Ячейки не по порядку Excel считает битым файлом, а на нашем листе справа
    // от «Проверки» лежит памятка — то есть строка уже занята.
    const out = insertColumnFormulas(
      sheet('<row r="2"><c r="A2" t="s"><v>1</v></c><c r="M2" t="s"><v>2</v></c></row>'),
      { column: "K", from: 2, to: 2, formula: () => "1" }
    );
    expect(out).toContain('<c r="A2" t="s"><v>1</v></c><c r="K2" t="str"><f>1</f></c><c r="M2"');
  });

  it("строки идут по возрастанию, даже если дописаны в середину", () => {
    const out = insertColumnFormulas(
      sheet('<row r="1"><c r="A1"/></row><row r="5"><c r="A5"/></row>'),
      { column: "K", from: 2, to: 6, formula: () => "1" }
    );
    expect(out.match(/<row r="(\d+)"/g)).toEqual([
      '<row r="1"', '<row r="2"', '<row r="3"', '<row r="4"', '<row r="5"', '<row r="6"',
    ]);
  });

  it("самозакрывающаяся строка раскрывается, а не ломается", () => {
    const out = insertColumnFormulas(sheet('<row r="2"/>'), {
      column: "K",
      from: 2,
      to: 2,
      formula: () => "1",
    });
    expect(out).toContain('<row r="2"><c r="K2" t="str"><f>1</f></c></row>');
  });

  it("лист без sheetData — честная ошибка, а не тихо испорченный файл", () => {
    expect(() => insertColumnFormulas("<worksheet/>", { column: "K", from: 2, to: 2, formula: () => "1" })).toThrow();
  });
});
