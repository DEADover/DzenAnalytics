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
 * Выпадающие списки, берущие значения ИЗ ДИАПАЗОНА другого листа.
 *
 * `addListValidation` держит варианты константой и упирается в 255 знаков — на
 * список счетов этого не хватает, а на список категорий тем более. Ссылка на
 * диапазон ограничений по длине не имеет и живёт вместе со справочником: обновил
 * лист — обновились все выпадашки.
 *
 * `hard: false` — мягкая проверка: Excel подсказывает список, но чужое значение
 * тоже принимает. Нужна там, где вписать своё законно (новый контрагент).
 */
export function addRangeValidations(
  sheetXml: string,
  items: { sqref: string; range: string; hard?: boolean }[]
): string {
  if (items.length === 0) return sheetXml;
  const body = items
    .map(({ sqref, range, hard = true }) =>
      `<dataValidation type="list" allowBlank="1" showInputMessage="1" ` +
      `showErrorMessage="${hard ? 1 : 0}" sqref="${sqref}">` +
      `<formula1>${esc(range)}</formula1></dataValidation>`
    )
    .join("");
  const xml = `<dataValidations count="${items.length}">${body}</dataValidations>`;
  // Порядок узлов по схеме тот же, что у `addListValidation`: после `sheetData`
  // и до `drawing`.
  if (sheetXml.includes("<drawing "))
    return sheetXml.replace(/<drawing /, `${xml}<drawing `);
  return sheetXml.replace("</worksheet>", `${xml}</worksheet>`);
}

/**
 * Ссылка на диапазон другого листа для формулы валидации.
 *
 * Имя листа с пробелом или кириллицей Excel требует в апострофах; апостроф
 * внутри имени удваивается.
 */
export function sheetRange(sheet: string, from: string, to: string): string {
  const name = /^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_.]*$/.test(sheet)
    ? sheet
    : `'${sheet.replace(/'/g, "''")}'`;
  return `${name}!${from}:${to}`;
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

/**
 * Дописать столбец формул на диапазон строк листа.
 *
 * Отличается от `setFormulas` тем, что не требует существующей ячейки: строк
 * под данные на свежем листе ещё нет, а формула-проверка нужна ЗАРАНЕЕ — она
 * должна сработать, как только человек введёт строку. Существующие строки
 * дополняются (ячейка встаёт по порядку колонок — иначе Excel считает файл
 * битым), недостающие создаются.
 *
 * Значение не кэшируем: пока строка пуста, результат всё равно пустой, а
 * посчитает его Excel при открытии (см. `forceRecalc`).
 */
export function insertColumnFormulas(
  sheetXml: string,
  opts: {
    column: string;
    from: number;
    to: number;
    formula: (row: number) => string;
    /**
     * Общая формула на весь диапазон: текст пишется один раз, остальные строки
     * ссылаются на него (`t="shared"`). Так Excel хранит собственные протяжки.
     *
     * Нужно там, где строк тысяча: развёрнутая формула на каждую строку
     * раздувала шаблон до сотни килобайт при полезной нагрузке в семь.
     * Требование одно — формулы строк должны отличаться только номером строки.
     */
    shared?: boolean;
  }
): string {
  const { column, from, to, formula, shared = false } = opts;
  const open = sheetXml.indexOf("<sheetData>");
  const close = sheetXml.indexOf("</sheetData>");
  if (open < 0 || close < 0) throw new Error("формулы: на листе нет sheetData");
  const body = sheetXml.slice(open + "<sheetData>".length, close);

  const rows = new Map<number, string>();
  const order: number[] = [];
  for (const m of body.matchAll(/<row[^>]*\br="(\d+)"[^>]*(?:\/>|>[\s\S]*?<\/row>)/g)) {
    const n = Number(m[1]);
    rows.set(n, m[0]);
    order.push(n);
  }

  const cell = (n: number) => {
    if (!shared) return `<c r="${column}${n}" t="str"><f>${esc(formula(n))}</f></c>`;
    const f =
      n === from
        ? `<f t="shared" ref="${column}${from}:${column}${to}" si="0">${esc(formula(n))}</f>`
        : `<f t="shared" si="0"/>`;
    return `<c r="${column}${n}" t="str">${f}</c>`;
  };

  for (let n = from; n <= to; n++) {
    const existing = rows.get(n);
    if (existing === undefined) {
      rows.set(n, `<row r="${n}">${cell(n)}</row>`);
      order.push(n);
      continue;
    }
    if (existing.endsWith("/>") && !existing.endsWith("</row>")) {
      // Пустая строка вида `<row r="3"/>` — раскрываем её в обычную.
      rows.set(n, `${existing.slice(0, -2)}>${cell(n)}</row>`);
      continue;
    }
    const inner = existing.slice(existing.indexOf(">") + 1, existing.lastIndexOf("</row>"));
    const head = existing.slice(0, existing.indexOf(">") + 1);
    const at = [...inner.matchAll(/<c r="([A-Z]+)\d+"/g)].find(
      (c) => colIndex(c[1]) > colIndex(column)
    );
    const pos = at?.index ?? inner.length;
    rows.set(n, `${head}${inner.slice(0, pos)}${cell(n)}${inner.slice(pos)}</row>`);
  }

  const merged = [...new Set(order)].sort((a, b) => a - b).map((n) => rows.get(n)).join("");
  return sheetXml.slice(0, open) + "<sheetData>" + merged + sheetXml.slice(close);
}

/** Номер колонки по буквам: «A» → 0, «AA» → 26. */
function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
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
