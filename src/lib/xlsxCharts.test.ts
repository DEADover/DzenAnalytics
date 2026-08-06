import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import {
  chartXml,
  columnLetter,
  drawingXml,
  injectCharts,
  rangeRef,
  sheetPathByName,
  valueScaling,
  type ChartSpec,
} from "./xlsxCharts";

/**
 * Проверка сбалансированности тегов.
 *
 * Диаграммы мы собираем строками, а Excel на кривой разметке не ругается — он
 * молча предлагает «восстановить» файл. Такую поломку не увидит ни один тест
 * на данные, поэтому разметку проверяем отдельно и грубо: каждый открытый тег
 * должен закрыться, и закрыться именно тем, что открывали.
 */
function xmlIsBalanced(xml: string): true | string {
  const stack: string[] = [];
  const re = /<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  const body = xml.replace(/<\?[^>]*\?>/g, "");
  while ((m = re.exec(body))) {
    const [, closing, name, , selfClose] = m;
    if (selfClose) continue;
    if (closing) {
      const open = stack.pop();
      if (open !== name) return `закрыли </${name}>, а открыт был <${open ?? "—"}>`;
    } else {
      stack.push(name);
    }
  }
  return stack.length === 0 ? true : `не закрыты: ${stack.join(", ")}`;
}

/** Порядок первых вхождений тегов в строке. */
function order(xml: string, tags: string[]): string[] {
  return tags
    .map((t) => ({ t, i: xml.indexOf(`<${t}`) }))
    .filter((x) => x.i >= 0)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.t);
}

function barSpec(extra: Partial<ChartSpec> = {}): ChartSpec {
  return {
    kind: "bar",
    title: "Факт — месяц",
    sheet: "Данные диаграмм",
    categories: { labels: ["Еда", "Дом"], column: 0, firstRow: 2 },
    series: [{ name: "Факт", column: 1, values: [100, 200], color: "0891B2" }],
    anchor: { col: 1, row: 10, toCol: 4, toRow: 28 },
    dataLabels: true,
    ...extra,
  };
}

describe("columnLetter", () => {
  it("нумерует колонки как Excel", () => {
    expect(columnLetter(0)).toBe("A");
    expect(columnLetter(25)).toBe("Z");
    expect(columnLetter(26)).toBe("AA");
    expect(columnLetter(27)).toBe("AB");
    expect(columnLetter(51)).toBe("AZ");
    expect(columnLetter(52)).toBe("BA");
  });
});

describe("rangeRef", () => {
  it("берёт имя листа в апострофы", () => {
    // Русские названия с пробелами без кавычек — синтаксическая ошибка формулы.
    expect(rangeRef("Данные диаграмм", 1, 2, 3)).toBe("'Данные диаграмм'!$B$2:$B$4");
  });

  it("удваивает апостроф внутри имени листа", () => {
    expect(rangeRef("Итог'2026", 0, 1, 1)).toBe("'Итог''2026'!$A$1:$A$1");
  });
});

describe("chartXml", () => {
  it("разметка сбалансирована", () => {
    expect(xmlIsBalanced(chartXml(barSpec()))).toBe(true);
    expect(xmlIsBalanced(chartXml(barSpec({ kind: "column" })))).toBe(true);
    expect(
      xmlIsBalanced(
        chartXml(
          barSpec({
            kind: "doughnut",
            series: [{ name: "План", column: 1, values: [1, 2], pointColors: ["A", null] }],
          })
        )
      )
    ).toBe(true);
  });

  it("соблюдает порядок элементов внутри barChart", () => {
    // Схема OOXML — это xsd:sequence: перестановка = «файл повреждён».
    const xml = chartXml(barSpec());
    const chart = /<c:barChart>[\s\S]*?<\/c:barChart>/.exec(xml)![0];
    expect(order(chart, ["c:barDir", "c:grouping", "c:varyColors", "c:ser", "c:gapWidth", "c:axId"])).toEqual([
      "c:barDir",
      "c:grouping",
      "c:varyColors",
      "c:ser",
      "c:gapWidth",
      "c:axId",
    ]);
  });

  it("соблюдает порядок элементов внутри ряда", () => {
    const xml = chartXml(
      barSpec({
        series: [
          { name: "Отклонение", column: 3, values: [5, -5], color: "16A34A", pointColors: ["16A34A", "DC2626"] },
        ],
      })
    );
    const ser = /<c:ser>[\s\S]*?<\/c:ser>/.exec(xml)![0];
    expect(
      order(ser, ["c:idx", "c:order", "c:tx", "c:spPr", "c:invertIfNegative", "c:dPt", "c:dLbls", "c:cat", "c:val"])
    ).toEqual(["c:idx", "c:order", "c:tx", "c:spPr", "c:invertIfNegative", "c:dPt", "c:dLbls", "c:cat", "c:val"]);
  });

  it("у бублика нет dLblPos — Excel на нём чинит файл", () => {
    const xml = chartXml(
      barSpec({ kind: "doughnut", series: [{ name: "План", column: 1, values: [1, 2] }] })
    );
    expect(xml).toContain("<c:doughnutChart>");
    expect(xml).not.toContain("c:dLblPos");
    // У полос она, наоборот, нужна — подписи снаружи столбика.
    expect(chartXml(barSpec())).toContain('<c:dLblPos val="outEnd"/>');
  });

  it("бублику не рисуются оси", () => {
    const xml = chartXml(
      barSpec({ kind: "doughnut", series: [{ name: "П", column: 1, values: [1] }] })
    );
    expect(xml).not.toContain("<c:catAx>");
    expect(xml).not.toContain("<c:valAx>");
  });

  it("точки без значения выпадают из кэша, а не превращаются в ноль", () => {
    const xml = chartXml(
      barSpec({ series: [{ name: "Рост", column: 4, values: [0.1, NaN, -0.2] }] })
    );
    const cache = /<c:numCache>[\s\S]*?<\/c:numCache>/.exec(xml)![0];
    expect(cache).toContain('<c:ptCount val="3"/>');
    expect(cache).toContain('idx="0"');
    expect(cache).not.toContain('idx="1"');
    expect(cache).toContain('idx="2"');
    expect(xml).toContain('<c:dispBlanksAs val="gap"/>');
  });

  it("ссылается на данные того листа, где они лежат", () => {
    const xml = chartXml(barSpec());
    expect(xml).toContain("&#39;Данные диаграмм&#39;!$A$2:$A$3".replace(/&#39;/g, "'"));
    expect(xml).toContain("'Данные диаграмм'!$B$2:$B$3");
  });

  it("подписи категорий стоят у края, а не на нулевой линии", () => {
    // Иначе на диаграмме отклонений название статьи ложится поверх столбика.
    const xml = chartXml(barSpec());
    const cat = /<c:catAx>[\s\S]*?<\/c:catAx>/.exec(xml)![0];
    expect(cat).toContain('<c:tickLblPos val="low"/>');
  });

  it("подписи категорий идут сверху вниз", () => {
    // maxMin у полос: иначе первая статья оказывается внизу, а читают сверху.
    expect(chartXml(barSpec())).toContain('<c:orientation val="maxMin"/>');
    expect(chartXml(barSpec({ kind: "column" }))).toContain('<c:orientation val="minMax"/>');
  });
});

describe("valueScaling", () => {
  it("даёт запас сверху, но не отрывает базу от нуля", () => {
    // Сдвинутая база превратила бы «вдвое больше» в «в десять раз длиннее».
    expect(valueScaling([0, 50, 100])).toBe(`<c:max val="130"/><c:min val="0"/>`);
  });

  it("запас с обеих сторон, когда есть и плюс, и минус", () => {
    expect(valueScaling([-50, 100])).toBe(`<c:max val="145"/><c:min val="-95"/>`);
  });

  it("на одних минусах верх остаётся нулём", () => {
    expect(valueScaling([-100, -20])).toBe(`<c:max val="0"/><c:min val="-130"/>`);
  });

  it("нечего раздвигать — не трогаем шкалу", () => {
    expect(valueScaling([])).toBe("");
    expect(valueScaling([0, 0])).toBe("");
    expect(valueScaling([NaN])).toBe("");
  });

  it("пропуски в данных не ломают границы", () => {
    expect(valueScaling([NaN, 100])).toBe(`<c:max val="130"/><c:min val="0"/>`);
  });
});

describe("drawingXml", () => {
  it("сбалансирован и связывает каждую диаграмму со своим rId", () => {
    const xml = drawingXml([barSpec(), barSpec()]);
    expect(xmlIsBalanced(xml)).toBe(true);
    expect(xml).toContain('r:id="rId1"');
    expect(xml).toContain('r:id="rId2"');
    // id рисунков в пределах листа должны быть разными.
    expect(xml).toContain('id="2"');
    expect(xml).toContain('id="3"');
  });

  it("переносит привязку к клеткам", () => {
    const xml = drawingXml([barSpec({ anchor: { col: 1, row: 10, toCol: 4, toRow: 28 } })]);
    expect(xml).toContain("<xdr:col>1</xdr:col>");
    expect(xml).toContain("<xdr:row>10</xdr:row>");
    expect(xml).toContain("<xdr:col>4</xdr:col>");
    expect(xml).toContain("<xdr:row>28</xdr:row>");
  });
});

// ── Сборка настоящего файла ──────────────────────────────────────────────────

async function sampleWorkbook(): Promise<Blob> {
  const { default: writeXlsxFile } = await import("write-excel-file/node");
  const buf = await writeXlsxFile([
    { data: [[{ value: "Дашборд", type: String }]], sheet: "Дашборд" },
    {
      data: [
        [{ value: "Статья", type: String }, { value: "Факт", type: String }],
        [{ value: "Еда", type: String }, { value: 100, type: Number }],
        [{ value: "Дом", type: String }, { value: 200, type: Number }],
      ],
      sheet: "Данные диаграмм",
    },
  ] as never).toBuffer();
  return new Blob([new Uint8Array(buf)]);
}

async function parts(blob: Blob): Promise<Record<string, string>> {
  const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const out: Record<string, string> = {};
  for (const [name, data] of Object.entries(zip)) out[name] = strFromU8(data);
  return out;
}

describe("injectCharts", () => {
  it("находит лист по имени, а не по порядку файла", async () => {
    const files = await parts(await sampleWorkbook());
    const dash = sheetPathByName(files, "Дашборд");
    const data = sheetPathByName(files, "Данные диаграмм");
    expect(dash).toMatch(/^xl\/worksheets\/sheet\d+\.xml$/);
    expect(data).not.toBe(dash);
  });

  it("падает понятной ошибкой на несуществующем листе", async () => {
    const files = await parts(await sampleWorkbook());
    expect(() => sheetPathByName(files, "Нет такого")).toThrow(/не найден/);
  });

  it("дописывает диаграммы в готовый файл", async () => {
    const out = await injectCharts(await sampleWorkbook(), "Дашборд", [barSpec(), barSpec()]);
    const files = await parts(out);

    expect(files["xl/charts/chart1.xml"]).toBeTruthy();
    expect(files["xl/charts/chart2.xml"]).toBeTruthy();
    expect(files["xl/drawings/drawing1.xml"]).toBeTruthy();

    // Типы содержимого: без них Excel не понимает новые части.
    expect(files["[Content_Types].xml"]).toContain("/xl/charts/chart1.xml");
    expect(files["[Content_Types].xml"]).toContain("/xl/drawings/drawing1.xml");

    // Рисунок связан с листом, диаграммы — с рисунком.
    const sheet = files[sheetPathByName(files, "Дашборд")];
    const rid = /<drawing r:id="(rId\d+)"\/>/.exec(sheet)![1];
    const rels = files[sheetPathByName(files, "Дашборд").replace(/([^/]+)$/, "_rels/$1.rels")];
    expect(rels).toContain(`Id="${rid}"`);
    expect(rels).toContain("../drawings/drawing1.xml");
    expect(files["xl/drawings/_rels/drawing1.xml.rels"]).toContain("../charts/chart1.xml");
  });

  it("ссылка на рисунок стоит последней в листе", async () => {
    // По схеме `<drawing/>` — последний потомок `<worksheet>`; поставить его
    // раньше значит получить «файл повреждён» на ровном месте.
    const out = await injectCharts(await sampleWorkbook(), "Дашборд", [barSpec()]);
    const files = await parts(out);
    const sheet = files[sheetPathByName(files, "Дашборд")];
    expect(sheet).toMatch(/<drawing r:id="rId\d+"\/><\/worksheet>$/);
  });

  it("не трогает остальные листы и остаётся читаемым zip", async () => {
    const before = await parts(await sampleWorkbook());
    const out = await injectCharts(await sampleWorkbook(), "Дашборд", [barSpec()]);
    const after = await parts(out);
    const dataPath = sheetPathByName(after, "Данные диаграмм");
    expect(after[dataPath]).toBe(before[dataPath]);
    expect(Object.keys(after).length).toBeGreaterThan(Object.keys(before).length);
  });

  it("применяет правки листов до сборки", async () => {
    const out = await injectCharts(await sampleWorkbook(), "Дашборд", [barSpec()], (files) => {
      const path = sheetPathByName(files, "Данные диаграмм");
      return { [path]: files[path].replace("<sheetData>", "<sheetData><!--патч-->") };
    });
    const files = await parts(out);
    expect(files[sheetPathByName(files, "Данные диаграмм")]).toContain("<!--патч-->");
  });

  it("без диаграмм всё равно отдаёт файл", async () => {
    const out = await injectCharts(await sampleWorkbook(), "Дашборд", []);
    const files = await parts(out);
    expect(files["xl/charts/chart1.xml"]).toBeUndefined();
    expect(files["xl/workbook.xml"]).toBeTruthy();
  });
});
