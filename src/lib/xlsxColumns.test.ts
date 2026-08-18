import { describe, it, expect } from "vitest";
import { applyColumnFormats } from "./xlsxColumns";

/** Стили в том виде, в каком их отдаёт пакет-писатель. */
const STYLES =
  '<?xml version="1.0"?><styleSheet>' +
  '<numFmts count="1"><numFmt numFmtId="100" formatCode="#,##0.00"/></numFmts>' +
  "<fonts count="+'"1"'+"><font/></fonts>" +
  '<cellXfs count="2"><xf ></xf><xf fontId="1"></xf></cellXfs></styleSheet>';

const SHEET =
  "<worksheet><cols>" +
  '<col min="1" max="1" width="12" customWidth="1"/>' +
  '<col min="2" max="2" width="10" customWidth="1"/>' +
  "</cols><sheetData/></worksheet>";

describe("applyColumnFormats", () => {
  it("КЛЮЧЕВОЕ: оформление достаётся ещё не набранным ячейкам", () => {
    // Пакет оформляет только написанные им ячейки, а строки под данные человек
    // создаст сам. Ссылка на стиль стоит у КОЛОНКИ — её и наследует новая
    // ячейка: дата встанет как 30.12.2026, сумма прижмётся вправо.
    const out = applyColumnFormats(STYLES, SHEET, [
      { column: 1, align: "center", numFmt: "DD.MM.YYYY" },
      { column: 2, align: "right", numFmt: "#,##0.00" },
    ]);
    expect(out.sheet).toContain('<col min="1" max="1" width="12" customWidth="1" style="2"/>');
    expect(out.sheet).toContain('<col min="2" max="2" width="10" customWidth="1" style="3"/>');
    expect(out.styles).toContain('<cellXfs count="4">');
  });

  it("новый формат числа получает свой номер, старый берётся готовым", () => {
    // Номера до 164 заняты встроенными форматами Excel — свои начинаются после.
    const out = applyColumnFormats(STYLES, SHEET, [
      { column: 1, numFmt: "DD.MM.YYYY" },
      { column: 2, numFmt: "#,##0.00" },
    ]);
    expect(out.styles).toContain('<numFmt numFmtId="164" formatCode="DD.MM.YYYY"/>');
    expect(out.styles).toContain('<numFmts count="2">');
    // Формат уже был в книге под номером 100 — второй записи не появляется.
    expect(out.styles.match(/formatCode="#,##0.00"/g)).toHaveLength(1);
    expect(out.styles).toContain('numFmtId="100" applyNumberFormat="1"');
  });

  it("книге без numFmts раздел заводится первым разделом стилей", () => {
    const bare =
      '<styleSheet><fonts count="1"><font/></fonts><cellXfs count="1"><xf ></xf></cellXfs></styleSheet>';
    const out = applyColumnFormats(bare, SHEET, [{ column: 1, numFmt: "DD.MM.YYYY" }]);
    expect(out.styles).toMatch(/<styleSheet><numFmts count="1">/);
  });

  it("одно выравнивание без формата числа не заводит лишнего", () => {
    const out = applyColumnFormats(STYLES, SHEET, [{ column: 1, align: "left" }]);
    expect(out.styles).toContain('<xf applyAlignment="1"><alignment horizontal="left"/></xf>');
    expect(out.styles).toContain('<numFmts count="1">');
  });

  it("диапазон колонок разбивается, чтобы оформилась только нужная", () => {
    const ranged = '<worksheet><cols><col min="1" max="3" width="9"/></cols></worksheet>';
    const out = applyColumnFormats(STYLES, ranged, [{ column: 2, align: "center" }]);
    expect(out.sheet).toContain('<col min="1" max="1" width="9"/>');
    expect(out.sheet).toContain('<col min="2" max="2" width="9" style="2"/>');
    expect(out.sheet).toContain('<col min="3" max="3" width="9"/>');
  });

  it("колонки, которых не просили, остаются нетронутыми", () => {
    const out = applyColumnFormats(STYLES, SHEET, [{ column: 1, align: "center" }]);
    expect(out.sheet).toContain('<col min="2" max="2" width="10" customWidth="1"/>');
  });

  it("книга без cellXfs — честная ошибка", () => {
    expect(() => applyColumnFormats("<styleSheet/>", SHEET, [{ column: 1 }])).toThrow();
  });
});
