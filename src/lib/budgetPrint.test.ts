import { describe, it, expect } from "vitest";
import {
  donutSlices,
  hasNegative,
  paginate,
  printBars,
  rowsPerPage,
  SHEET,
} from "./budgetPrint";

const COLORS = { used: "#0891B2", over: "#DC2626", rest: "#E5E7EB" };

describe("printBars", () => {
  it("самая длинная полоса занимает всю ширину, остальные — свою долю", () => {
    const bars = printBars([
      { label: "Еда", value: 100 },
      { label: "Дом", value: 50 },
      { label: "Связь", value: 25 },
    ]);
    expect(bars.map((b) => b.ratio)).toEqual([1, 0.5, 0.25]);
  });

  it("масштаб общий и считается по модулю", () => {
    // Иначе плюс и минус мерились бы разными линейками, и полоса «−100»
    // выглядела бы такой же, как «+20».
    const bars = printBars([
      { label: "a", value: -100 },
      { label: "b", value: 20 },
    ]);
    expect(bars[0].ratio).toBe(1);
    expect(bars[1].ratio).toBe(0.2);
    expect(bars[0].negative).toBe(true);
    expect(bars[1].negative).toBe(false);
  });

  it("пустое значение остаётся пустым и в масштаб не входит", () => {
    // «Роста не от чего считать» — это не ноль: ноль сказал бы «роста не было».
    const bars = printBars([
      { label: "a", value: null },
      { label: "b", value: 10 },
    ]);
    expect(bars[0].value).toBeNull();
    expect(bars[0].ratio).toBe(0);
    expect(bars[1].ratio).toBe(1);
  });

  it("все нули — полос нет, но и деления на ноль тоже", () => {
    const bars = printBars([
      { label: "a", value: 0 },
      { label: "b", value: 0 },
    ]);
    expect(bars.every((b) => b.ratio === 0)).toBe(true);
  });

  it("NaN обрабатывается как «нет значения»", () => {
    expect(printBars([{ label: "a", value: NaN }])[0].value).toBeNull();
  });
});

describe("hasNegative", () => {
  it("видит, нужна ли ось посередине", () => {
    expect(hasNegative(printBars([{ label: "a", value: 5 }]))).toBe(false);
    expect(hasNegative(printBars([{ label: "a", value: -5 }]))).toBe(true);
  });
});

describe("donutSlices", () => {
  it("недорасход: освоено и остаток", () => {
    const s = donutSlices(75, 100, COLORS);
    expect(s).toHaveLength(2);
    expect(s[0].share).toBeCloseTo(0.75);
    expect(s[0].offset).toBe(0);
    expect(s[1].share).toBeCloseTo(0.25);
    expect(s[1].offset).toBeCloseTo(0.75);
  });

  it("перерасход показывается своей долей, а не отрицательным остатком", () => {
    const s = donutSlices(120, 100, COLORS);
    expect(s.map((x) => x.color)).toEqual([COLORS.used, COLORS.over]);
    expect(s[0].share + s[1].share).toBeCloseTo(1);
    // Дуга не едет назад: смещения только вперёд.
    expect(s[1].offset).toBeGreaterThan(s[0].offset);
  });

  it("доли идут подряд и в сумме дают круг", () => {
    const s = donutSlices(60, 100, COLORS);
    const last = s[s.length - 1];
    expect(last.offset + last.share).toBeCloseTo(1);
  });

  it("нулевые доли выпадают, а не рисуются нулевой дугой", () => {
    expect(donutSlices(100, 100, COLORS)).toHaveLength(1);
  });

  it("ни плана, ни факта — сплошное серое кольцо, а не пустота", () => {
    const s = donutSlices(0, 0, COLORS);
    expect(s).toEqual([{ share: 1, offset: 0, color: COLORS.rest }]);
  });
});

describe("paginate", () => {
  it("режет список по размеру страницы", () => {
    expect(paginate([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("короткий список остаётся одной страницей", () => {
    expect(paginate([1, 2], 10)).toEqual([[1, 2]]);
  });

  it("пустой список даёт одну пустую страницу, а не ноль страниц", () => {
    // Иначе печать вышла бы вообще без листа.
    expect(paginate([], 10)).toEqual([[]]);
  });

  it("нулевой размер страницы не зацикливает", () => {
    expect(paginate([1, 2, 3], 0)).toEqual([[1, 2, 3]]);
  });
});

describe("rowsPerPage", () => {
  it("считает, сколько строк влезает на лист", () => {
    // Числа сняты с настоящей вёрстки, а не подобраны. Один ряд — это пара
    // разрезов на лист: так статья видна целиком, а не кусками по восемь.
    expect(rowsPerPage(1)).toBe(31);
    expect(rowsPerPage(3)).toBe(8);
  });

  it("чем меньше рядов диаграмм, тем больше строк помещается", () => {
    expect(rowsPerPage(2)).toBeGreaterThan(rowsPerPage(3));
    expect(rowsPerPage(1)).toBeGreaterThan(rowsPerPage(2));
  });

  it("ряд диаграмм со строками помещается в отведённую высоту", () => {
    // Считаем ту же высоту, что потом занимает вёрстка: строки, просветы между
    // ними и рамка диаграммы.
    const rows = rowsPerPage(3);
    const usable = SHEET.height - SHEET.padding - SHEET.header;
    const perRow = (usable - SHEET.gap * 2) / 3;
    const real = SHEET.chrome + rows * SHEET.row + (rows - 1) * SHEET.rowGap;
    expect(real).toBeLessThanOrEqual(perRow);
    // И при этом не расточительно: ещё одна строка уже не влезла бы.
    expect(real + SHEET.row + SHEET.rowGap).toBeGreaterThan(perRow);
  });

  it("на крошечном листе остаётся хотя бы одна строка", () => {
    // Иначе `paginate` получил бы ноль и зациклился.
    expect(rowsPerPage(3, { ...SHEET, height: 200 })).toBe(1);
  });
});

describe("printBars — предел шкалы", () => {
  it("с пределом полоса читается сама по себе, а не относительно выброса", () => {
    // Тот самый случай со скриншота: рядом с «+394 %» падение «−100 %» —
    // предельное, дальше падать некуда — съёживалось до четверти полосы.
    const values = [
      { label: "обнулилось", value: -1 },
      { label: "выброс", value: 3.937 },
      { label: "треть", value: 0.324 },
    ];
    const relative = printBars(values);
    expect(relative[0].ratio).toBeCloseTo(0.254, 3);

    const capped = printBars(values, { cap: 1 });
    expect(capped[0].ratio).toBe(1);
    expect(capped[2].ratio).toBeCloseTo(0.324, 3);
  });

  it("выброс упирается в край и помечается", () => {
    const bars = printBars([{ label: "a", value: 26.574 }], { cap: 1 });
    expect(bars[0].ratio).toBe(1);
    expect(bars[0].clamped).toBe(true);
    // Значение остаётся точным — усечена только полоса.
    expect(bars[0].value).toBe(26.574);
  });

  it("ровно на пределе — не усечение", () => {
    const bars = printBars([{ label: "a", value: -1 }], { cap: 1 });
    expect(bars[0].clamped).toBe(false);
    expect(bars[0].negative).toBe(true);
  });

  it("без предела ничего не помечается усечённым", () => {
    // У денег масштаб по максимуму верен: там сравниваются величины.
    expect(printBars([{ label: "a", value: 100 }, { label: "b", value: 1 }]).every((b) => !b.clamped)).toBe(true);
  });

  it("пустое значение не считается усечённым", () => {
    expect(printBars([{ label: "a", value: null }], { cap: 1 })[0].clamped).toBe(false);
  });
});
