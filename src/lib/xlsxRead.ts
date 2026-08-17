/**
 * Чтение .xlsx — ровно столько, сколько нужно импорту операций.
 *
 * Библиотеки-читалки в проект не берём: standalone-сборка инлайнит всё в
 * единственный HTML, и SheetJS весом почти в мегабайт там неуместен — тем же
 * доводом в отчётах уже отказались от exceljs. А xlsx — это zip с XML, и
 * `fflate` в дереве зависимостей уже есть: диаграммы, формулы и группировка
 * строк дописываются поверх готового файла ровно так же.
 *
 * Что читаем: значения ячеек одного листа. Чего НЕ читаем и почему:
 *
 *   • `xl/styles.xml` — самая громоздкая часть любой читалки (числовые форматы,
 *     встроенные и пользовательские), и она нужна лишь чтобы отличить дату от
 *     числа. Нам не нужна: колонки известны по шапке шаблона, и число в колонке
 *     «Дата» — это дата по определению.
 *   • формулы — берём их посчитанное значение, оно лежит в файле рядом.
 *   • объединённые ячейки, картинки, стили — импорту безразличны.
 */

import { sheetPathByName } from "./xlsxCharts";

/** Значение ячейки: либо текст, либо число. Пустых ячеек в файле нет вовсе. */
export type XlsxCell =
  | { kind: "text"; text: string }
  | { kind: "number"; num: number };

export interface XlsxSheet {
  /** Адрес («B7») → значение. Только непустые. */
  cells: Map<string, XlsxCell>;
  /** Номер последней строки с данными, 1-based. Ноль — лист пуст. */
  lastRow: number;
  /**
   * Книга в системе дат 1904 (так писал Excel для Mac).
   *
   * Ошибка в четыре года и один день — не та вещь, которую замечают глазами в
   * отчёте импорта, поэтому флаг читаем всегда.
   */
  date1904: boolean;
}

/** Первые байты zip — по ним отличаем .xlsx от .xls и от чего угодно ещё. */
export function looksLikeZip(buf: ArrayBuffer): boolean {
  const head = new Uint8Array(buf.slice(0, 4));
  // «PK\x03\x04» — обычный архив, «PK\x05\x06» — пустой (тоже валидный).
  return head[0] === 0x50 && head[1] === 0x4b && (head[2] === 3 || head[2] === 5);
}

/**
 * Прочитать один лист книги по его имени.
 *
 * Бросает с человеческой формулировкой: сообщение уходит прямо на экран, а
 * «Unexpected token &lt;» пользователю ничего не объясняет.
 */
export async function readXlsxSheet(
  buf: ArrayBuffer,
  sheetName: string
): Promise<XlsxSheet> {
  if (!looksLikeZip(buf)) {
    throw new Error("Это не файл .xlsx. Пересохраните таблицу в формате Excel (.xlsx).");
  }
  const { unzipSync, strFromU8 } = await import("fflate");
  let files: Record<string, string>;
  try {
    const raw = unzipSync(new Uint8Array(buf));
    files = {};
    for (const [name, bytes] of Object.entries(raw)) {
      // Читаем только XML книги: картинки и шрифты внутри архива нам не нужны,
      // а декодировать их как текст — впустую тратить память на больших файлах.
      if (name.endsWith(".xml") || name.endsWith(".rels")) {
        files[name] = strFromU8(bytes);
      }
    }
  } catch {
    throw new Error("Файл повреждён — Excel не смог бы открыть его тоже.");
  }
  if (!files["xl/workbook.xml"]) {
    throw new Error("Это не книга Excel: внутри нет ни одного листа.");
  }

  const path = sheetPathByName(files, sheetName);
  const sheetXml = files[path];
  if (!sheetXml) throw new Error(`Лист «${sheetName}» не найден в книге.`);

  return {
    cells: parseSheet(sheetXml, parseSharedStrings(files["xl/sharedStrings.xml"])),
    lastRow: lastRowOf(sheetXml),
    date1904: /date1904="(1|true)"/.test(files["xl/workbook.xml"]),
  };
}

/** Текст ячейки; число тоже отдаётся текстом — так его видел пользователь. */
export function cellText(sheet: XlsxSheet, addr: string): string {
  const c = sheet.cells.get(addr);
  if (!c) return "";
  return c.kind === "text" ? c.text : String(c.num);
}

/** Число ячейки; `null` — там текст или пусто. */
export function cellNumber(sheet: XlsxSheet, addr: string): number | null {
  const c = sheet.cells.get(addr);
  return c && c.kind === "number" ? c.num : null;
}

/** Буква колонки из адреса: «AB12» → «AB». */
export function colOf(addr: string): string {
  return addr.replace(/\d+$/, "");
}

/** Номер строки из адреса: «AB12» → 12. */
export function rowOf(addr: string): number {
  return Number(/\d+$/.exec(addr)?.[0] ?? 0);
}

/**
 * Серийная дата Excel → календарные части.
 *
 * Точка отсчёта — 1899-12-30, а не 1900-01-01: Excel считает 1900-й
 * високосным (ошибка тянется из Lotus 1-2-3), и сдвиг на два дня встроен в саму
 * эпоху. В системе 1904 отсчёт от 1904-01-01.
 *
 * Возвращаем части, а не `Date`: дальше они кладутся в строку «ГГГГ-ММ-ДД» без
 * участия часового пояса, который в `Date` норовит сдвинуть дату на сутки.
 */
export function serialToParts(
  serial: number,
  date1904 = false
): { y: number; m: number; d: number; hh: number; mm: number } {
  const days = Math.floor(serial);
  const frac = serial - days;
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const at = new Date(epoch + days * 86_400_000);
  // Доля суток → часы и минуты. Секунды отбрасываем: у операции их всё равно
  // нет, а 11:59:59 из-за плавающей точки должно читаться как 12:00.
  // 23:59:59.9 после округления даёт ровно сутки — оставляем 23:59, а не
  // переливаем в следующий день: дата у строки уже посчитана.
  const minutes = Math.min(1439, Math.round(frac * 24 * 60));
  return {
    y: at.getUTCFullYear(),
    m: at.getUTCMonth() + 1,
    d: at.getUTCDate(),
    hh: Math.floor(minutes / 60),
    mm: minutes % 60,
  };
}

/**
 * Общая таблица строк книги.
 *
 * Текст ячейки может быть разбит на «руны» (`<r><t>`) — так Excel хранит строку
 * с разным начертанием внутри. Склеиваем все `<t>` подряд: пользователь видел
 * одну строку, значит и мы должны прочитать одну.
 */
function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  for (const si of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)) {
    const body = si[1] ?? "";
    let text = "";
    for (const t of body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) text += t[1];
    out.push(decodeXml(text));
  }
  return out;
}

/**
 * Ячейки листа.
 *
 * Идём строго по атрибуту `r` («B7»), а не по порядку `<c>`: пустых ячеек в
 * файле просто нет, и счёт по порядку сдвинул бы половину строки на колонку
 * влево — ровно та ошибка, из-за которой чужие самописные читалки славятся
 * съехавшими данными.
 */
function parseSheet(xml: string, shared: string[]): Map<string, XlsxCell> {
  const cells = new Map<string, XlsxCell>();
  const body = xml.slice(xml.indexOf("<sheetData"));
  for (const m of body.matchAll(
    /<c\b([^>]*?)\/>|<c\b([^>]*?)>([\s\S]*?)<\/c>/g
  )) {
    const attrs = m[1] ?? m[2] ?? "";
    const inner = m[3] ?? "";
    const addr = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
    if (!addr) continue;
    const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? "n";
    const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];

    if (type === "s") {
      const idx = Number(v);
      const text = shared[idx] ?? "";
      if (text) cells.set(addr, { kind: "text", text });
      continue;
    }
    if (type === "inlineStr") {
      let text = "";
      for (const t of inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) text += t[1];
      text = decodeXml(text);
      if (text) cells.set(addr, { kind: "text", text });
      continue;
    }
    // Ошибка формулы (#REF!, #Н/Д) — для нас пустая ячейка: в отчёте она даст
    // понятное «не заполнено», а не загадочный текст в поле суммы.
    if (type === "e") continue;
    if (type === "str" || type === "b") {
      const text = decodeXml(v ?? "");
      if (text) cells.set(addr, { kind: "text", text });
      continue;
    }
    if (v === undefined || v === "") continue;
    const num = Number(v);
    if (Number.isFinite(num)) cells.set(addr, { kind: "number", num });
  }
  return cells;
}

/** Последняя строка с данными — по атрибутам `<row r="…">`. */
function lastRowOf(xml: string): number {
  let last = 0;
  for (const m of xml.matchAll(/<row\b[^>]*\br="(\d+)"/g)) {
    const n = Number(m[1]);
    if (n > last) last = n;
  }
  return last;
}

/** Обратное экранирование XML, включая числовые ссылки. */
function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // Амперсанд последним: иначе «&amp;lt;» превратилось бы в «<».
    .replace(/&amp;/g, "&");
}
