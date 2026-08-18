/**
 * Оформление КОЛОНКИ целиком: выравнивание и формат числа.
 *
 * Пакет-писатель оформляет только те ячейки, которые сам же и написал. У
 * шаблона под данные ячеек ещё нет — человек их создаст, набирая строки, и
 * унаследуют они оформление КОЛОНКИ. Поэтому дата, набранная в пустой строке,
 * покажется как 30.12.2026, сумма — с разделителем разрядов и по правому краю,
 * а не так, как решит Excel по своему настроению.
 *
 * Формат в колонке — это ещё и подсказка: набранное «18.11.25» Excel приведёт к
 * виду колонки, и человек сразу увидит, понял ли его ввод как дату.
 */

/** Оформление одной колонки. Номер с единицы: A = 1. */
export interface ColumnFormat {
  column: number;
  align?: "left" | "center" | "right";
  /** Код формата Excel: «DD.MM.YYYY», «#,##0.00». */
  numFmt?: string;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

/**
 * Вписать оформление колонок в стили книги и в разметку листа.
 *
 * Возвращает обе изменённые части: стиль живёт в `styles.xml`, а ссылка на
 * него — в `<cols>` листа. По отдельности они бессмысленны, поэтому и функция
 * одна.
 */
export function applyColumnFormats(
  stylesXml: string,
  sheetXml: string,
  formats: ColumnFormat[]
): { styles: string; sheet: string } {
  if (formats.length === 0) return { styles: stylesXml, sheet: sheetXml };

  let styles = stylesXml;

  // 1. Форматы чисел. Свои коды начинаются со 164-го — до него номера заняты
  //    встроенными форматами Excel.
  const existing = new Map<string, number>();
  let maxId = 163;
  for (const m of styles.matchAll(/<numFmt numFmtId="(\d+)" formatCode="([^"]*)"\/>/g)) {
    existing.set(m[2], Number(m[1]));
    maxId = Math.max(maxId, Number(m[1]));
  }
  const added: string[] = [];
  const numFmtId = (code?: string): number => {
    if (!code) return 0;
    const hit = existing.get(code);
    if (hit !== undefined) return hit;
    const id = ++maxId;
    existing.set(code, id);
    added.push(`<numFmt numFmtId="${id}" formatCode="${esc(code)}"/>`);
    return id;
  };
  const ids = formats.map((f) => numFmtId(f.numFmt));

  if (added.length > 0) {
    const has = /<numFmts count="(\d+)">/.exec(styles);
    if (has) {
      styles = styles
        .replace(/<numFmts count="\d+">/, `<numFmts count="${Number(has[1]) + added.length}">`)
        .replace("</numFmts>", `${added.join("")}</numFmts>`);
    } else {
      // По схеме `numFmts` идёт первым разделом таблицы стилей.
      styles = styles.replace(
        /(<styleSheet[^>]*>)/,
        `$1<numFmts count="${added.length}">${added.join("")}</numFmts>`
      );
    }
  }

  // 2. Записи оформления. Индекс новой записи — её место в `cellXfs`.
  const xfs = /<cellXfs count="(\d+)">/.exec(styles);
  if (!xfs) throw new Error("оформление колонок: в стилях нет cellXfs");
  const first = Number(xfs[1]);
  const entries = formats.map((f, i) => {
    const attrs = [
      ids[i] ? `numFmtId="${ids[i]}" applyNumberFormat="1"` : "",
      f.align ? 'applyAlignment="1"' : "",
    ]
      .filter(Boolean)
      .join(" ");
    const body = f.align ? `<alignment horizontal="${f.align}"/>` : "";
    return `<xf ${attrs}>${body}</xf>`;
  });
  styles = styles
    .replace(/<cellXfs count="\d+">/, `<cellXfs count="${first + entries.length}">`)
    .replace("</cellXfs>", `${entries.join("")}</cellXfs>`);

  const styleOf = new Map<number, number>();
  formats.forEach((f, i) => styleOf.set(f.column, first + i));

  // 3. Ссылка на оформление в `<cols>`. Писатель отдаёт по элементу на колонку,
  //    но диапазон в принципе законен — тогда разбиваем его на колонки.
  const sheet = sheetXml.replace(/<col\b[^>]*\/>/g, (col) => {
    const min = Number(/min="(\d+)"/.exec(col)?.[1] ?? 0);
    const max = Number(/max="(\d+)"/.exec(col)?.[1] ?? 0);
    if (!min || !max) return col;
    const touched = [...styleOf.keys()].some((c) => c >= min && c <= max);
    if (!touched) return col;
    if (max - min > 64)
      throw new Error(`оформление колонок: слишком широкий диапазон ${min}:${max}`);
    const parts: string[] = [];
    for (let c = min; c <= max; c++) {
      const id = styleOf.get(c);
      const one = col.replace(/min="\d+"/, `min="${c}"`).replace(/max="\d+"/, `max="${c}"`);
      parts.push(id === undefined ? one : one.replace("/>", ` style="${id}"/>`));
    }
    return parts.join("");
  });

  return { styles, sheet };
}
