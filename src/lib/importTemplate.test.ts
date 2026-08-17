import { describe, it, expect } from "vitest";
import {
  OPS_COLUMNS,
  OP_TYPES,
  SHEET_DICTS,
  SHEET_HOWTO,
  SHEET_OPS,
  TEMPLATE_MARKER,
  TEMPLATE_VERSION,
  buildTemplateSheets,
  opsValidations,
  type TemplateDicts,
} from "./importTemplate";
import { addRangeValidations, sheetRange } from "./xlsxFormulas";

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

  it("КЛЮЧЕВОЕ: лист «Операции» отдаётся пустым, кроме шапки", () => {
    // Строка-пример внутри данных — это операция, которую кто-нибудь забудет
    // удалить и отправит в облако. Примеры живут отдельным листом.
    const ops = sheetOf(SHEET_OPS).data;
    expect(ops).toHaveLength(1);
    expect(ops[0].map((c) => c.value)).toEqual([...OPS_COLUMNS]);
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
