/**
 * Нативные диаграммы Excel поверх готового .xlsx.
 *
 * `write-excel-file` умеет всё, кроме диаграмм, а нам нужны именно живые: чтобы
 * пользователь поправил цифру — и столбик поехал, поменял цвет — и он остался.
 * Картинка этого не даёт: xlsx с картинками — это PDF, у которого зачем-то есть
 * ячейки.
 *
 * Поэтому берём валидный файл, который отдала библиотека, и дописываем в него
 * недостающие части OOXML: `xl/charts/chartN.xml`, `xl/drawings/drawing1.xml`,
 * связи и типы содержимого, плюс ссылку `<drawing/>` в самом листе. Файл —
 * обычный zip, `fflate` уже лежит в дереве зависимостей.
 *
 * ВАЖНО: в схемах OOXML порядок дочерних элементов строгий (`xsd:sequence`).
 * Excel не прощает перестановку и молча предлагает «восстановить» файл, поэтому
 * порядок в шаблонах ниже трогать нельзя. Комментарии `// порядок:` рядом с
 * каждым узлом перечисляют его по спецификации.
 */

// `fflate` подгружается динамически — ровно как в `categoryReportXlsx`: zip
// нужен раз в жизни по кнопке «Excel» и в стартовом бандле ему делать нечего.

const NS_C = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_XDR = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";

const CT_DRAWING = "application/vnd.openxmlformats-officedocument.drawing+xml";
const CT_CHART = "application/vnd.openxmlformats-officedocument.drawingml.chart+xml";
const REL_DRAWING =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing";
const REL_CHART =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart";

/** Тип диаграммы. `bar` — полосы вбок (как в примере), `column` — столбики вверх. */
export type ChartKind = "bar" | "column" | "doughnut";

export interface ChartSeries {
  /** Подпись ряда в легенде. */
  name: string;
  values: number[];
  /** Цвет ряда, RRGGBB без решётки. */
  color?: string;
  /**
   * Цвета отдельных точек — для «отклонения» и «роста», где знак важнее ряда:
   * плюс зелёный, минус красный. `null` = точка красится цветом ряда.
   */
  pointColors?: (string | null)[];
}

/** Прямоугольник привязки к сетке листа, границы в нуле-индексированных клетках. */
export interface ChartAnchor {
  col: number;
  row: number;
  toCol: number;
  toRow: number;
}

export interface ChartSpec {
  kind: ChartKind;
  title?: string;
  /** Лист, на котором лежат исходные данные (он же — лист диаграммы). */
  sheet: string;
  /** Подписи категорий и их адрес на листе: колонка (0-инд.) и первая строка (1-инд.). */
  categories: { labels: string[]; column: number; firstRow: number };
  /** Ряды; адрес значений считается по `column` каждого ряда. */
  series: (ChartSeries & { column: number })[];
  anchor: ChartAnchor;
  /** Показывать значения на точках. */
  dataLabels?: boolean;
  legend?: boolean;
  /** Формат чисел в подписях, по умолчанию «#,##0». */
  numberFormat?: string;
  /** Диаметр дырки бублика в процентах, 10–90. */
  holeSize?: number;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 0 → A, 25 → Z, 26 → AA. */
export function columnLetter(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/**
 * Ссылка на диапазон в формате формул Excel: `'Лист'!$B$5:$B$14`.
 *
 * Имя листа берём в апострофы ВСЕГДА: у нас листы называются по-русски и с
 * пробелами («Год к году»), а без кавычек такая ссылка — синтаксическая ошибка.
 * Внутренний апостроф в имени листа удваивается.
 */
export function rangeRef(
  sheet: string,
  column: number,
  firstRow: number,
  count: number
): string {
  const c = columnLetter(column);
  const name = sheet.replace(/'/g, "''");
  return `'${name}'!$${c}$${firstRow}:$${c}$${firstRow + count - 1}`;
}

function fill(color?: string): string {
  return color ? `<c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr>` : "";
}

function strCache(values: string[]): string {
  const pts = values
    .map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`)
    .join("");
  return `<c:ptCount val="${values.length}"/>${pts}`;
}

function numCache(values: number[], format: string): string {
  // Точки без значения (роста не от чего считать) ПРОПУСКАЕМ, а не подставляем
  // ноль: ноль на диаграмме — это «роста не было», а у нас «сравнить не с чем».
  // `dispBlanksAs=gap` оставляет на их месте пропуск.
  const pts = values
    .map((v, i) => (Number.isFinite(v) ? `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>` : ""))
    .join("");
  return `<c:formatCode>${esc(format)}</c:formatCode><c:ptCount val="${values.length}"/>${pts}`;
}

/**
 * Кэш значений внутри диаграммы — не дубликат данных «на всякий случай», а
 * то, что рисуется до первого пересчёта: программы просмотра, которые формулы
 * не считают (Preview, Numbers, вьюер в почте), показывают именно его.
 */
function catRef(spec: ChartSpec): string {
  const { labels, column, firstRow } = spec.categories;
  return `<c:cat><c:strRef><c:f>${esc(
    rangeRef(spec.sheet, column, firstRow, labels.length)
  )}</c:f><c:strCache>${strCache(labels)}</c:strCache></c:strRef></c:cat>`;
}

function valRef(spec: ChartSpec, ser: ChartSeries & { column: number }): string {
  const format = spec.numberFormat || "#,##0";
  return `<c:val><c:numRef><c:f>${esc(
    rangeRef(spec.sheet, ser.column, spec.categories.firstRow, ser.values.length)
  )}</c:f><c:numCache>${numCache(ser.values, format)}</c:numCache></c:numRef></c:val>`;
}

function dLbls(spec: ChartSpec, position?: string): string {
  if (!spec.dataLabels) return "";
  // порядок: numFmt, spPr, txPr, dLblPos, showLegendKey, showVal, showCatName,
  // showSerName, showPercent, showBubbleSize.
  // dLblPos у бублика запрещён — Excel на нём как раз и «чинит» файл.
  return (
    "<c:dLbls>" +
    `<c:numFmt formatCode="${esc(spec.numberFormat || "#,##0")}" sourceLinked="0"/>` +
    "<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>" +
    '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="800"/></a:pPr><a:endParaRPr lang="ru-RU"/></a:p></c:txPr>' +
    (position ? `<c:dLblPos val="${position}"/>` : "") +
    '<c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/>' +
    '<c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/>' +
    "</c:dLbls>"
  );
}

function dataPoints(ser: ChartSeries, bubble: boolean): string {
  if (!ser.pointColors) return "";
  return ser.pointColors
    .map((color, idx) => {
      if (!color) return "";
      // порядок: idx, invertIfNegative, marker, bubble3D, explosion, spPr.
      return (
        `<c:dPt><c:idx val="${idx}"/>` +
        (bubble ? '<c:invertIfNegative val="0"/><c:bubble3D val="0"/>' : "") +
        `${fill(color)}</c:dPt>`
      );
    })
    .join("");
}

function barSeries(spec: ChartSpec): string {
  return spec.series
    .map((ser, i) => {
      // порядок: idx, order, tx, spPr, invertIfNegative, pictureOptions, dPt,
      // dLbls, trendline, errBars, cat, val, shape.
      return (
        `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>` +
        `<c:tx><c:v>${esc(ser.name)}</c:v></c:tx>` +
        fill(ser.color) +
        '<c:invertIfNegative val="0"/>' +
        dataPoints(ser, true) +
        dLbls(spec, spec.kind === "bar" ? "outEnd" : "outEnd") +
        catRef(spec) +
        valRef(spec, ser) +
        "</c:ser>"
      );
    })
    .join("");
}

function pieSeries(spec: ChartSpec): string {
  return spec.series
    .map((ser, i) => {
      // порядок: idx, order, tx, spPr, explosion, dPt, dLbls, cat, val.
      return (
        `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>` +
        `<c:tx><c:v>${esc(ser.name)}</c:v></c:tx>` +
        dataPoints(ser, false) +
        dLbls(spec) +
        catRef(spec) +
        valRef(spec, ser) +
        "</c:ser>"
      );
    })
    .join("");
}

function title(spec: ChartSpec): string {
  if (!spec.title) return '<c:autoTitleDeleted val="1"/>';
  return (
    "<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p>" +
    '<a:pPr><a:defRPr sz="1000" b="1"/></a:pPr>' +
    `<a:r><a:rPr lang="ru-RU" sz="1000" b="1"/><a:t>${esc(spec.title)}</a:t></a:r>` +
    '</a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>'
  );
}

function legend(spec: ChartSpec): string {
  return spec.legend ? '<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>' : "";
}

const CAT_AX_ID = 111111111;
const VAL_AX_ID = 222222222;

/**
 * Границы оси значений с запасом под подписи.
 *
 * Excel растягивает шкалу ровно по данным, и подпись самого длинного столбика
 * («−9 034 ₽») выезжает за край области — накрывая название статьи. Раздвигаем
 * шкалу на пятую часть: ось всё равно скрыта, а подписям есть куда встать.
 * Возвращает пустую строку, когда двигать нечего (все значения нулевые).
 */
export function valueScaling(values: number[]): string {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return "";
  const max = Math.max(...finite, 0);
  const min = Math.min(...finite, 0);
  const span = max - min;
  if (span === 0) return "";
  // Доля подобрана по самому тесному случаю: подпись отрицательного столбика
  // («−11 500 ₽») уходит влево от его конца, а у края стоит название статьи, и
  // между ними должно остаться место. Меньше 0.3 — они сходятся.
  const pad = span * 0.3;
  // Ноль остаётся нулём: сдвинутая база превратила бы «в два раза больше» в
  // «в десять раз длиннее».
  const hi = max > 0 ? max + pad : 0;
  const lo = min < 0 ? min - pad : 0;
  // порядок scaling: logBase, orientation, max, min.
  return `<c:max val="${hi}"/><c:min val="${lo}"/>`;
}

function axes(kind: ChartKind, values: number[]): string {
  // Ось значений прячем (`delete=1`): на полосах и так стоят подписи, а вторая
  // шкала рядом с ними — шум. Ось категорий оставляем, это названия статей.
  const catPos = kind === "bar" ? "l" : "b";
  const valPos = kind === "bar" ? "b" : "l";
  // порядок catAx: axId, scaling, delete, axPos, majorGridlines, minorGridlines,
  // title, numFmt, majorTickMark, minorTickMark, tickLblPos, spPr, txPr, crossAx,
  // crosses, auto, lblAlgn, lblOffset, noMultiLvlLbl.
  const cat =
    `<c:catAx><c:axId val="${CAT_AX_ID}"/>` +
    // maxMin у полос: иначе первая категория оказывается внизу, а читают сверху.
    `<c:scaling><c:orientation val="${kind === "bar" ? "maxMin" : "minMax"}"/></c:scaling>` +
    `<c:delete val="0"/><c:axPos val="${catPos}"/>` +
    // `low`, а не `nextTo`: ось стоит на нуле, и при отрицательных значениях
    // подписи категорий оказывались ПОВЕРХ столбиков («Еда» на красной полосе
    // отклонения). У края они читаются в любом знаке.
    '<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/>' +
    '<c:spPr><a:ln><a:solidFill><a:srgbClr val="D1D5DB"/></a:solidFill></a:ln></c:spPr>' +
    '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="800"/></a:pPr><a:endParaRPr lang="ru-RU"/></a:p></c:txPr>' +
    `<c:crossAx val="${VAL_AX_ID}"/><c:crosses val="autoZero"/><c:auto val="1"/>` +
    '<c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>';
  // порядок valAx: axId, scaling, delete, axPos, ..., crossAx, crosses,
  // crossBetween, majorUnit, minorUnit.
  const val =
    `<c:valAx><c:axId val="${VAL_AX_ID}"/>` +
    `<c:scaling><c:orientation val="minMax"/>${valueScaling(values)}</c:scaling>` +
    `<c:delete val="1"/><c:axPos val="${valPos}"/>` +
    '<c:numFmt formatCode="#,##0" sourceLinked="0"/>' +
    '<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>' +
    `<c:crossAx val="${CAT_AX_ID}"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`;
  return cat + val;
}

function plotArea(spec: ChartSpec): string {
  if (spec.kind === "doughnut") {
    // порядок doughnutChart: varyColors, ser, dLbls, firstSliceAng, holeSize.
    return (
      "<c:plotArea><c:layout/>" +
      '<c:doughnutChart><c:varyColors val="1"/>' +
      pieSeries(spec) +
      `<c:firstSliceAng val="0"/><c:holeSize val="${spec.holeSize ?? 62}"/>` +
      "</c:doughnutChart></c:plotArea>"
    );
  }
  // порядок barChart: barDir, grouping, varyColors, ser, dLbls, gapWidth,
  // overlap, serLines, axId, axId.
  return (
    "<c:plotArea><c:layout/>" +
    `<c:barChart><c:barDir val="${spec.kind === "bar" ? "bar" : "col"}"/>` +
    '<c:grouping val="clustered"/><c:varyColors val="0"/>' +
    barSeries(spec) +
    '<c:gapWidth val="60"/><c:overlap val="-20"/>' +
    `<c:axId val="${CAT_AX_ID}"/><c:axId val="${VAL_AX_ID}"/></c:barChart>` +
    axes(spec.kind, spec.series.flatMap((s) => s.values)) +
    "</c:plotArea>"
  );
}

export function chartXml(spec: ChartSpec): string {
  // порядок chartSpace: date1904, lang, roundedCorners, style, ..., chart, spPr.
  // порядок chart: title, autoTitleDeleted, ..., plotArea, legend, plotVisOnly,
  // dispBlanksAs.
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}">` +
    '<c:lang val="ru-RU"/><c:roundedCorners val="0"/>' +
    "<c:chart>" +
    title(spec) +
    plotArea(spec) +
    legend(spec) +
    '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/>' +
    "</c:chart>" +
    '<c:spPr><a:noFill/><a:ln><a:solidFill><a:srgbClr val="E5E7EB"/></a:solidFill></a:ln></c:spPr>' +
    "</c:chartSpace>"
  );
}

export function drawingXml(specs: ChartSpec[]): string {
  const anchors = specs
    .map((spec, i) => {
      const a = spec.anchor;
      return (
        "<xdr:twoCellAnchor>" +
        `<xdr:from><xdr:col>${a.col}</xdr:col><xdr:colOff>0</xdr:colOff>` +
        `<xdr:row>${a.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
        `<xdr:to><xdr:col>${a.toCol}</xdr:col><xdr:colOff>0</xdr:colOff>` +
        `<xdr:row>${a.toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
        '<xdr:graphicFrame macro="">' +
        `<xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Диаграмма ${i + 1}"/>` +
        "<xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>" +
        '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>' +
        `<a:graphic><a:graphicData uri="${NS_C}">` +
        `<c:chart xmlns:c="${NS_C}" xmlns:r="${NS_R}" r:id="rId${i + 1}"/>` +
        "</a:graphicData></a:graphic></xdr:graphicFrame>" +
        "<xdr:clientData/></xdr:twoCellAnchor>"
      );
    })
    .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<xdr:wsDr xmlns:xdr="${NS_XDR}" xmlns:a="${NS_A}">${anchors}</xdr:wsDr>`
  );
}

function relationships(items: { id: string; type: string; target: string }[]): string {
  const rels = items
    .map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${esc(r.target)}"/>`)
    .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<Relationships xmlns="${NS_R.replace("/officeDocument/2006/relationships", "/package/2006/relationships")}">${rels}</Relationships>`
  );
}

/**
 * Имя файла листа по его человеческому названию.
 *
 * Идти через `workbook.xml` → связи, а не гадать «первый лист = sheet1.xml»:
 * порядок файлов внутри архива библиотеке никто не диктует, а молча положить
 * диаграммы не на тот лист — худший вид поломки, он выглядит как «работает».
 */
export function sheetPathByName(
  files: Record<string, string>,
  name: string
): string {
  const workbook = files["xl/workbook.xml"];
  const relsXml = files["xl/_rels/workbook.xml.rels"];
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*\/>/g)].map((m) => m[0]);
  const target = sheets.find((s) => {
    const n = /name="([^"]*)"/.exec(s)?.[1] ?? "";
    return (
      n.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"') ===
      name
    );
  });
  if (!target) throw new Error(`Лист «${name}» не найден в книге`);
  const rid = /r:id="([^"]*)"/.exec(target)?.[1];
  const rel = [...relsXml.matchAll(/<Relationship\b[^>]*\/>/g)]
    .map((m) => m[0])
    .find((r) => r.includes(`Id="${rid}"`));
  const path = rel ? /Target="([^"]*)"/.exec(rel)?.[1] : undefined;
  if (!path) throw new Error(`Не нашли файл листа «${name}»`);
  return path.startsWith("/") ? path.slice(1) : `xl/${path.replace(/^\.\//, "")}`;
}

/** Следующий свободный rId в файле связей (или в пустом наборе). */
function nextRelId(relsXml: string | null): string {
  if (!relsXml) return "rId1";
  const ids = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]));
  return `rId${(ids.length ? Math.max(...ids) : 0) + 1}`;
}

/**
 * Вписывает диаграммы в готовый .xlsx и отдаёт новый архив.
 *
 * `sheetName` — лист, НА КОТОРОМ они появятся; данные каждая диаграмма берёт
 * оттуда, откуда указано в её `spec.sheet`.
 */
export function chartParts(
  files: Record<string, string>,
  sheetName: string,
  specs: ChartSpec[]
): Record<string, string> {
  const sheetPath = sheetPathByName(files, sheetName);

  // 1. Части диаграмм и рисунка.
  const out: Record<string, string> = {};
  specs.forEach((spec, i) => {
    out[`xl/charts/chart${i + 1}.xml`] = chartXml(spec);
  });
  out["xl/drawings/drawing1.xml"] = drawingXml(specs);
  out["xl/drawings/_rels/drawing1.xml.rels"] = relationships(
    specs.map((_, i) => ({
      id: `rId${i + 1}`,
      type: REL_CHART,
      target: `../charts/chart${i + 1}.xml`,
    }))
  );

  // 2. Связь листа с рисунком.
  const relsPath = sheetPath.replace(/([^/]+)$/, "_rels/$1.rels");
  const existing = files[relsPath] ?? null;
  const rid = nextRelId(existing);
  const drawingRel = `<Relationship Id="${rid}" Type="${REL_DRAWING}" Target="../drawings/drawing1.xml"/>`;
  out[relsPath] = existing
    ? existing.replace("</Relationships>", `${drawingRel}</Relationships>`)
    : relationships([{ id: rid, type: REL_DRAWING, target: "../drawings/drawing1.xml" }]);

  // 3. Ссылка на рисунок в самом листе. По схеме `<drawing/>` идёт в самом
  //    конце `<worksheet>` — ставим прямо перед закрывающим тегом.
  out[sheetPath] = files[sheetPath].replace(
    "</worksheet>",
    `<drawing r:id="${rid}"/></worksheet>`
  );

  // 4. Типы содержимого: без них Excel не знает, чем считать новые части.
  const overrides =
    `<Override PartName="/xl/drawings/drawing1.xml" ContentType="${CT_DRAWING}"/>` +
    specs
      .map(
        (_, i) =>
          `<Override PartName="/xl/charts/chart${i + 1}.xml" ContentType="${CT_CHART}"/>`
      )
      .join("");
  out["[Content_Types].xml"] = files["[Content_Types].xml"].replace(
    "</Types>",
    `${overrides}</Types>`
  );
  return out;
}

/**
 * Вписывает диаграммы в готовый .xlsx и отдаёт новый архив.
 *
 * `sheetName` — лист, НА КОТОРОМ они появятся; данные каждая диаграмма берёт
 * оттуда, откуда указано в её `spec.sheet`. `patchSheets` — дополнительные
 * правки разметки листов (у нас это группировка строк плюсиками).
 */
export async function injectCharts(
  blob: Blob,
  sheetName: string,
  specs: ChartSpec[],
  patchSheets?: (files: Record<string, string>) => Record<string, string>
): Promise<Blob> {
  const { unzipSync, zipSync, strToU8, strFromU8 } = await import("fflate");
  const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const files: Record<string, string> = {};
  for (const [name, data] of Object.entries(zip)) files[name] = strFromU8(data);

  const patched = {
    ...(patchSheets ? patchSheets(files) : {}),
  };
  const withPatches = { ...files, ...patched };
  Object.assign(patched, specs.length ? chartParts(withPatches, sheetName, specs) : {});

  // `[Content_Types].xml` кладём первым: так делают все реализации, и часть
  // читателей потокового zip рассчитывает встретить его до остальных частей.
  const merged: Record<string, Uint8Array> = {};
  const put = (name: string) => {
    merged[name] = name in patched ? strToU8(patched[name]) : zip[name];
  };
  put("[Content_Types].xml");
  for (const name of Object.keys(zip)) if (name !== "[Content_Types].xml") put(name);
  for (const [name, xml] of Object.entries(patched)) {
    if (!(name in merged)) merged[name] = strToU8(xml);
  }
  return new Blob([zipSync(merged, { level: 6 })], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
