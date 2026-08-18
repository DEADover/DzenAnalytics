/**
 * Заметки (они же примечания) на ячейках готового .xlsx.
 *
 * Подсказка «для каких типов операций эта колонка» должна жить в самой ячейке
 * шапки, а не в её тексте: приписка в тексте лезет за ширину колонки, ломает
 * договор о названиях и выглядит запиской на полях. Заметка — штатный для Excel
 * способ: красный уголок в углу ячейки, текст по наведению.
 *
 * Пакет-писатель заметок не умеет, поэтому части дописываем сами. Формат
 * старый, «legacy»: сама заметка лежит в `comments1.xml`, а её жёлтый прямо-
 * угольник — отдельным VML-рисунком, без которого Excel заметку не покажет.
 * Приём тот же, что у диаграмм (см. `xlsxCharts`): xlsx — это zip с XML.
 */

import { sheetPathByName } from "./xlsxCharts";

const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_COMMENTS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";
const REL_VML =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing";
const CT_COMMENTS =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml";
const CT_VML = "application/vnd.openxmlformats-officedocument.vmlDrawing";

export interface SheetNote {
  /** Адрес ячейки: «A1». */
  ref: string;
  /** Первая строка заметки — жирная, как в заметках самого Excel. */
  title: string;
  text: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Колонка и строка адреса, обе с нуля: «C1» → { col: 2, row: 0 }. */
function cellPos(ref: string): { col: number; row: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) throw new Error(`заметки: непонятный адрес ячейки «${ref}»`);
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: Number(m[2]) - 1 };
}

/** Шрифт заметки — тот же, каким её пишет сам Excel. */
const RPR = '<sz val="9"/><color indexed="81"/><rFont val="Tahoma"/><family val="2"/>';

export function commentsXml(notes: SheetNote[]): string {
  const list = notes
    .map(
      (n) =>
        `<comment ref="${n.ref}" authorId="0"><text>` +
        `<r><rPr><b/>${RPR}</rPr><t xml:space="preserve">${esc(n.title)}\n</t></r>` +
        `<r><rPr>${RPR}</rPr><t xml:space="preserve">${esc(n.text)}</t></r>` +
        `</text></comment>`
    )
    .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<comments xmlns="${NS_MAIN}"><authors><author/></authors>` +
    `<commentList>${list}</commentList></comments>`
  );
}

/**
 * VML-рисунок заметок: по прямоугольнику на каждую.
 *
 * Прямоугольник спрятан (`visibility:hidden`) — Excel показывает его при
 * наведении. Якорь задаёт, где он всплывёт: правее и ниже своей ячейки.
 */
export function notesVml(notes: SheetNote[]): string {
  const shapes = notes
    .map((n, i) => {
      const { col, row } = cellPos(n.ref);
      const anchor = [col + 1, 15, row, 2, col + 4, 40, row + 7, 8].join(", ");
      return (
        `<v:shape id="_x0000_s${1025 + i}" type="#_x0000_t202" ` +
        `style='position:absolute;margin-left:60pt;margin-top:2pt;width:260pt;` +
        `height:96pt;z-index:${i + 1};visibility:hidden' fillcolor="#ffffe1" o:insetmode="auto">` +
        `<v:fill color2="#ffffe1"/>` +
        `<v:shadow on="t" color="black" obscured="t"/>` +
        `<v:path o:connecttype="none"/>` +
        `<v:textbox style='mso-direction-alt:auto'><div style='text-align:left'></div></v:textbox>` +
        `<x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/>` +
        `<x:Anchor>${anchor}</x:Anchor><x:AutoFill>False</x:AutoFill>` +
        `<x:Row>${row}</x:Row><x:Column>${col}</x:Column></x:ClientData></v:shape>`
      );
    })
    .join("");
  return (
    `<xml xmlns:v="urn:schemas-microsoft-com:vml" ` +
    `xmlns:o="urn:schemas-microsoft-com:office:office" ` +
    `xmlns:x="urn:schemas-microsoft-com:office:excel">` +
    `<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout>` +
    `<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" ` +
    `path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/>` +
    `<v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>` +
    `${shapes}</xml>`
  );
}

/** Следующий свободный номер связи в файле связей листа. */
function nextRelId(relsXml: string | null, offset = 0): string {
  const ids = relsXml ? [...relsXml.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1])) : [];
  return `rId${(ids.length ? Math.max(...ids) : 0) + 1 + offset}`;
}

/**
 * Части заметок для листа: что дописать в архив книги.
 *
 * Отдаёт только новые и изменённые файлы — как `chartParts`. Номер файлов
 * фиксированный (`comments1`, `vmlDrawing1`): заметки у нас на одном листе, и
 * плодить нумерацию ради воображаемого второго не нужно.
 */
export function noteParts(
  files: Record<string, string>,
  sheetName: string,
  notes: SheetNote[]
): Record<string, string> {
  if (notes.length === 0) return {};
  const sheetPath = sheetPathByName(files, sheetName);
  const out: Record<string, string> = {};

  out["xl/comments1.xml"] = commentsXml(notes);
  out["xl/drawings/vmlDrawing1.vml"] = notesVml(notes);

  // Связи листа: заметка и её рисунок — две отдельные ссылки.
  const relsPath = sheetPath.replace(/([^/]+)$/, "_rels/$1.rels");
  const existing = files[relsPath] ?? null;
  const vmlId = nextRelId(existing);
  const commentsId = nextRelId(existing, 1);
  const added =
    `<Relationship Id="${vmlId}" Type="${REL_VML}" Target="../drawings/vmlDrawing1.vml"/>` +
    `<Relationship Id="${commentsId}" Type="${REL_COMMENTS}" Target="../comments1.xml"/>`;
  out[relsPath] = existing
    ? existing.replace("</Relationships>", `${added}</Relationships>`)
    : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `${added}</Relationships>`;

  // Ссылка на VML в самом листе. По схеме `legacyDrawing` идёт после
  // `dataValidations` и после `drawing` — то есть в самом конце листа.
  out[sheetPath] = files[sheetPath].replace(
    "</worksheet>",
    `<legacyDrawing r:id="${vmlId}"/></worksheet>`
  );

  // Типы содержимого: у vml — по расширению, у заметок — на саму часть.
  let types = files["[Content_Types].xml"];
  if (!types.includes('Extension="vml"'))
    types = types.replace(/(<Types[^>]*>)/, `$1<Default ContentType="${CT_VML}" Extension="vml"/>`);
  out["[Content_Types].xml"] = types.replace(
    "</Types>",
    `<Override ContentType="${CT_COMMENTS}" PartName="/xl/comments1.xml"/></Types>`
  );
  return out;
}
