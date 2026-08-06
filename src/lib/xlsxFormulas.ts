/**
 * Формулы, выпадающие списки и пересчёт — поверх готового .xlsx.
 *
 * `write-excel-file` пишет только константы. Без формул интерактивный отчёт
 * невозможен: выпадашка «месяц» переключала бы подпись, а цифры оставались бы
 * теми же. Поэтому после записи заменяем значения нужных ячеек на формулы —
 * значение остаётся рядом кэшем, чтобы файл был читаем и до пересчёта.
 *
 * Приём тот же, что у диаграмм (см. `xlsxCharts`): xlsx — это zip с XML.
 */

/** Экранирование текста в XML-атрибуте или узле. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Проставить формулы ячейкам листа.
 *
 * Ключ — адрес («B2»), значение — формула БЕЗ ведущего «=» и с английскими
 * именами функций: в файле они всегда английские, локализованные имена Excel
 * подставляет только при показе.
 *
 * Уже посчитанное значение ячейки остаётся кэшем `<v>`: программы, которые
 * формулы не считают (Preview, почтовые вьюеры), покажут именно его. Формулы
 * с текстовым результатом (`IFERROR(...,"")`) кэш теряют — иначе пришлось бы
 * гадать про тип, а пустая ячейка до пересчёта честнее неверного числа.
 *
 * Бросает, если ячейка на листе не нашлась: молча выгруженный отчёт с мёртвой
 * выпадашкой хуже честной ошибки.
 */
export function setFormulas(sheetXml: string, formulas: Map<string, string>): string {
  if (formulas.size === 0) return sheetXml;
  const done = new Set<string>();
  const out = sheetXml.replace(
    /<c r="([A-Z]+\d+)"([^>]*)\/>|<c r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g,
    (match, selfRef: string, selfAttrs: string, ref: string, attrs: string, body: string) => {
      const addr = selfRef ?? ref;
      const formula = formulas.get(addr);
      if (formula === undefined) return match;
      done.add(addr);
      // Тип ячейки (`t="s"` — общая строка) с формулой несовместим: результат
      // формулы в таблицу строк не попадает. Убираем, оставляя оформление.
      const keep = (selfAttrs ?? attrs).replace(/\st="[^"]*"/g, "");
      const cached = selfRef ? "" : /<v>([\s\S]*?)<\/v>/.exec(body)?.[0] ?? "";
      // Кэш оставляем только у числовых результатов: `t="str"` для текстового
      // кэша пришлось бы выставлять по типу формулы, а мы его не знаем.
      const numeric = /^<v>-?[\d.eE+]+<\/v>$/.test(cached) ? cached : "";
      return `<c r="${addr}"${keep}><f>${esc(formula)}</f>${numeric}</c>`;
    }
  );
  const missing = [...formulas.keys()].filter((a) => !done.has(a));
  if (missing.length > 0)
    throw new Error(`формулы: ячейки не найдены на листе — ${missing.join(", ")}`);
  return out;
}

/**
 * Выпадающий список значений в ячейке.
 *
 * По схеме `dataValidations` идёт ПОСЛЕ `sheetData` и ДО `drawing`; ставим
 * перед рисунком, если он уже вписан, иначе перед концом листа.
 */
export function addListValidation(
  sheetXml: string,
  cell: string,
  options: string[]
): string {
  // Список константой ограничен 255 знаками — двенадцати месяцев хватает с
  // запасом, но проверяем: молча обрезанный список Excel считает битым файлом.
  const list = options.join(",");
  if (list.length > 250)
    throw new Error(`выпадающий список ${cell}: ${list.length} знаков, лимит 255`);
  const xml =
    `<dataValidations count="1">` +
    `<dataValidation type="list" allowBlank="0" showInputMessage="1" showErrorMessage="1" sqref="${cell}">` +
    `<formula1>&quot;${esc(list)}&quot;</formula1>` +
    `</dataValidation></dataValidations>`;
  if (sheetXml.includes("<drawing "))
    return sheetXml.replace(/<drawing /, `${xml}<drawing `);
  return sheetXml.replace("</worksheet>", `${xml}</worksheet>`);
}

/**
 * Заставить Excel пересчитать книгу при открытии.
 *
 * Наши формулы приходят с кэшем от генератора, а не от Excel; без этого флага
 * он верит кэшу и показывает старые числа, пока не тронешь ячейку.
 */
export function forceRecalc(workbookXml: string): string {
  if (workbookXml.includes("<calcPr"))
    return workbookXml.replace(/<calcPr[^>]*\/>/, '<calcPr calcId="0" fullCalcOnLoad="1"/>');
  // По схеме `calcPr` идёт после `bookViews`/`sheets` и до `definedNames`?
  // Нет: порядок — fileVersion, workbookPr, bookViews, sheets, definedNames,
  // calcPr. Проще всего вставить прямо перед закрывающим тегом.
  return workbookXml.replace("</workbook>", '<calcPr calcId="0" fullCalcOnLoad="1"/></workbook>');
}

/** Адрес ячейки из нуля-индексированной колонки и единица-индексированной строки. */
export function cellRef(column: number, row: number): string {
  let n = column;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `${letters}${row}`;
}
