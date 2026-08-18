import { describe, it, expect } from "vitest";
import { commentsXml, noteParts, notesVml, type SheetNote } from "./xlsxNotes";

const notes: SheetNote[] = [
  { ref: "A1", title: "Дата", text: "Дата операции: 30.12.2026" },
  { ref: "K1", title: "Проверка", text: "Формула проверяет строку «на месте» & сразу" },
];

/** Книга в том виде, в каком её отдаёт пакет-писатель. */
const files = (): Record<string, string> => ({
  "xl/workbook.xml":
    '<?xml version="1.0"?><workbook><sheets>' +
    '<sheet name="Операции" sheetId="1" r:id="rId1"/></sheets></workbook>',
  "xl/_rels/workbook.xml.rels":
    '<Relationships><Relationship Id="rId1" Type="…/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  "xl/worksheets/sheet1.xml": "<worksheet><sheetData/></worksheet>",
  "xl/worksheets/_rels/sheet1.xml.rels": "<Relationships></Relationships>",
  "[Content_Types].xml": '<Types xmlns="…"><Default Extension="xml"/></Types>',
});

describe("commentsXml", () => {
  it("КЛЮЧЕВОЕ: заметка — заголовок жирным и текст следом", () => {
    // Так заметку пишет сам Excel, и человек видит привычное: имя колонки
    // сверху, пояснение под ним.
    const xml = commentsXml(notes);
    expect(xml).toContain('<comment ref="A1" authorId="0">');
    expect(xml).toContain("<b/>");
    expect(xml).toContain("Дата операции: 30.12.2026");
  });

  it("амперсанд и кавычки уезжают экранированными", () => {
    expect(commentsXml(notes)).toContain("&amp; сразу");
  });
});

describe("notesVml", () => {
  it("КЛЮЧЕВОЕ: по прямоугольнику на заметку, спрятанному до наведения", () => {
    // Без VML Excel заметку не покажет вовсе: текст лежит отдельно от формы.
    const vml = notesVml(notes);
    expect(vml.match(/<v:shape /g)).toHaveLength(2);
    expect(vml).toContain("visibility:hidden");
    expect(vml).toContain('ObjectType="Note"');
  });

  it("ячейка заметки записана номерами строки и колонки с нуля", () => {
    // «K1» — одиннадцатая колонка, первая строка.
    const vml = notesVml(notes);
    expect(vml).toContain("<x:Row>0</x:Row><x:Column>0</x:Column>");
    expect(vml).toContain("<x:Row>0</x:Row><x:Column>10</x:Column>");
  });

  it("непонятный адрес — ошибка, а не молча кривой файл", () => {
    expect(() => notesVml([{ ref: "1A", title: "т", text: "т" }])).toThrow();
  });
});

describe("noteParts — сборка в книгу", () => {
  it("КЛЮЧЕВОЕ: все четыре части на месте, иначе Excel чинит файл", () => {
    // Заметке нужны: сам текст, форма, связи листа с обеими частями и типы
    // содержимого. Без любой из них Excel встречает человека «файл повреждён».
    const out = noteParts(files(), "Операции", notes);
    expect(Object.keys(out).sort()).toEqual([
      "[Content_Types].xml",
      "xl/comments1.xml",
      "xl/drawings/vmlDrawing1.vml",
      "xl/worksheets/_rels/sheet1.xml.rels",
      "xl/worksheets/sheet1.xml",
    ]);
    expect(out["xl/worksheets/_rels/sheet1.xml.rels"]).toContain("vmlDrawing1.vml");
    expect(out["xl/worksheets/_rels/sheet1.xml.rels"]).toContain("../comments1.xml");
    expect(out["[Content_Types].xml"]).toContain('Extension="vml"');
    expect(out["[Content_Types].xml"]).toContain("/xl/comments1.xml");
  });

  it("лист ссылается на ту же связь, что заведена под рисунок", () => {
    const out = noteParts(files(), "Операции", notes);
    const id = /<legacyDrawing r:id="(rId\d+)"\/>/.exec(out["xl/worksheets/sheet1.xml"])?.[1];
    expect(id).toBeTruthy();
    expect(out["xl/worksheets/_rels/sheet1.xml.rels"]).toContain(
      `Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing"`
    );
  });

  it("номера связей не сталкиваются с уже существующими", () => {
    const f = files();
    f["xl/worksheets/_rels/sheet1.xml.rels"] =
      '<Relationships><Relationship Id="rId1" Type="…" Target="…"/></Relationships>';
    const rels = noteParts(f, "Операции", notes)["xl/worksheets/_rels/sheet1.xml.rels"];
    expect(rels).toContain('Id="rId2"');
    expect(rels).toContain('Id="rId3"');
    expect(rels.match(/Id="rId1"/g)).toHaveLength(1);
  });

  it("без заметок книга не трогается вовсе", () => {
    expect(noteParts(files(), "Операции", [])).toEqual({});
  });
});
