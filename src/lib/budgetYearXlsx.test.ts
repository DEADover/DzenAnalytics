import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import {
  barChartHeight,
  buildCharts,
  buildDashboardSheet,
  buildDataSheet,
  buildMonthsSheet,
  buildWorkbook,
  buildYoySheet,
  patchSheets,
  planSlices,
} from "./budgetYearXlsx";
import { atMonth, buildBudgetDashboard, ytd } from "./budgetDashboard";
import { buildBudgetYear } from "./budgetYear";
import { addRowOutline, moneyFormat } from "./categoryReportXlsx";
import { sheetPathByName, chartXml } from "./xlsxCharts";
import type { BudgetLine } from "./budgets";
import type { Transaction } from "../types";

let seq = 0;
function tx(p: Partial<Transaction>): Transaction {
  return {
    id: `t${++seq}`,
    date: "2026-01-15",
    amount: 0,
    amountBase: 0,
    currency: "RUB",
    kind: "expense",
    category: "Еда",
    subcategory: null,
    payee: "",
    comment: "",
    account: "Карта",
    ...(p as object),
  } as Transaction;
}

function line(p: Partial<BudgetLine>): BudgetLine {
  return {
    id: `l${++seq}`,
    category: "Еда",
    subcategory: null,
    kind: "expense",
    amount: 0,
    recurrence: "monthly",
    startMonth: "2026-01",
    endMonth: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...p,
  };
}

const FORMAT = moneyFormat("RUB");

function sample() {
  const lines = [
    line({ amount: 10_000 }),
    line({ subcategory: "Кафе", amount: 4000 }),
    line({ category: "Дом", amount: 20_000 }),
    line({ category: "Зарплата", kind: "income", amount: 150_000 }),
  ];
  const txs = [
    tx({ date: "2026-01-10", amountBase: 9000 }),
    tx({ date: "2026-01-11", amountBase: 3000, subcategory: "Кафе" }),
    tx({ date: "2026-02-10", amountBase: 12_000 }),
    tx({ date: "2026-02-11", amountBase: 25_000, category: "Дом" }),
    tx({ date: "2026-01-05", amountBase: 150_000, kind: "income", category: "Зарплата" }),
    tx({ date: "2026-02-05", amountBase: 155_000, kind: "income", category: "Зарплата" }),
  ];
  const prevTxs = [
    tx({ date: "2025-01-10", amountBase: 7000 }),
    tx({ date: "2025-02-10", amountBase: 8000 }),
    tx({ date: "2025-01-05", amountBase: 140_000, kind: "income", category: "Зарплата" }),
  ];
  return {
    report: buildBudgetYear(lines, txs, 2026),
    prev: buildBudgetYear([], prevTxs, 2025),
  };
}

/** Значения строки листа, без оформления. */
function values(row: ({ value?: string | number | null } | null)[]): (string | number | null)[] {
  return row.map((c) => (c ? (c.value ?? null) : null));
}

describe("planSlices", () => {
  it("недорасход: освоено и остаток", () => {
    expect(planSlices(8000, 10_000).values).toEqual([8000, 0, 2000]);
  });

  it("перерасход показывается отдельной долей, а остаток не уходит в минус", () => {
    // Одной долей «остаток» тут не обойтись: −2000 превратили бы бублик в кашу.
    expect(planSlices(12_000, 10_000).values).toEqual([10_000, 2000, 0]);
  });

  it("без плана бублик пустой, а не сломанный", () => {
    expect(planSlices(5000, 0).values).toEqual([0, 5000, 0]);
  });
});

describe("buildDataSheet", () => {
  it("шапка и статьи идут в том порядке, на который смотрят диаграммы", () => {
    const { report, prev } = sample();
    const d = buildBudgetDashboard(report, prev, 1);
    const sheet = buildDataSheet(d, FORMAT);
    expect(values(sheet.rows[0])[0]).toBe("Статья");
    expect(values(sheet.rows[1])[0]).toBe(d.rows[0].category);
    expect(values(sheet.rows[1])[1]).toBe(atMonth(d.rows[0].factByMonth, 1));
    expect(values(sheet.rows[1])[5]).toBe(ytd(d.rows[0].factByMonth, 1));
  });

  it("доли бубликов лежат там, куда указывает диаграмма", () => {
    const { report, prev } = sample();
    const d = buildBudgetDashboard(report, prev, 1);
    const sheet = buildDataSheet(d, FORMAT);
    // `firstRow` — нумерация Excel, с единицы.
    const row = sheet.rows[sheet.donutMonth.firstRow - 1];
    expect(values(row)[0]).toBe("Освоено");
    expect(values(row)[1]).toBe(sheet.donutMonth.values[0]);
    const last = sheet.rows[sheet.donutYtd.firstRow + 1];
    expect(values(last)[0]).toBe("Остаток");
  });

  it("рост без базы остаётся пустой ячейкой, а не нулём", () => {
    const report = buildBudgetYear([], [tx({ date: "2026-01-10", amountBase: 100 })], 2026);
    const d = buildBudgetDashboard(report, buildBudgetYear([], [], 2025), 0);
    const sheet = buildDataSheet(d, FORMAT);
    // Ноль здесь читался бы как «роста не было», хотя сравнивать не с чем.
    expect(values(sheet.rows[1])[4]).toBeNull();
    expect(values(sheet.rows[1])[8]).toBeNull();
  });
});

describe("buildCharts", () => {
  it("десять диаграмм: два бублика и восемь полосовых", () => {
    const { report, prev } = sample();
    const d = buildBudgetDashboard(report, prev, 1);
    const charts = buildCharts(d, buildDataSheet(d, FORMAT), FORMAT, 14);
    expect(charts).toHaveLength(10);
    expect(charts.filter((c) => c.kind === "doughnut")).toHaveLength(2);
    expect(charts.filter((c) => c.kind === "bar")).toHaveLength(8);
  });

  it("каждая диаграмма смотрит на лист данных", () => {
    const { report, prev } = sample();
    const d = buildBudgetDashboard(report, prev, 1);
    const charts = buildCharts(d, buildDataSheet(d, FORMAT), FORMAT, 14);
    for (const c of charts) expect(c.sheet).toBe("Данные диаграмм");
  });

  it("значения ряда совпадают со столбцом, на который он ссылается", () => {
    // Разъехавшийся адрес — самая тихая поломка: файл открывается, цифры чужие.
    const { report, prev } = sample();
    const d = buildBudgetDashboard(report, prev, 1);
    const data = buildDataSheet(d, FORMAT);
    for (const chart of buildCharts(d, data, FORMAT, 14)) {
      if (chart.kind === "doughnut") continue;
      for (const ser of chart.series) {
        ser.values.forEach((v, i) => {
          const cell = data.rows[i + 1][ser.column] as { value?: number | null };
          if (Number.isNaN(v)) expect(cell.value ?? null).toBeNull();
          else expect(cell.value).toBe(v);
        });
      }
    }
  });

  it("статьи в подписях совпадают со статьями листа данных", () => {
    const { report, prev } = sample();
    const d = buildBudgetDashboard(report, prev, 1);
    const data = buildDataSheet(d, FORMAT);
    const charts = buildCharts(d, data, FORMAT, 14);
    const bar = charts.find((c) => c.kind === "bar")!;
    bar.categories.labels.forEach((label, i) => {
      expect(values(data.rows[i + 1])[0]).toBe(label);
    });
  });

  it("отклонение красится по знаку: плюс зелёный, минус красный", () => {
    const { report, prev } = sample();
    const d = buildBudgetDashboard(report, prev, 1);
    const charts = buildCharts(d, buildDataSheet(d, FORMAT), FORMAT, 14);
    const varChart = charts.find((c) => c.title === "Отклонение от плана — месяц")!;
    const ser = varChart.series[0];
    ser.values.forEach((v, i) => {
      expect(ser.pointColors![i]).toBe(v >= 0 ? "16A34A" : "DC2626");
    });
  });

  it("у расхода рост — это плохо, поэтому знаки зеркальные", () => {
    const report = buildBudgetYear(
      [],
      [tx({ date: "2026-01-10", amountBase: 100 }), tx({ date: "2026-02-10", amountBase: 200 })],
      2026
    );
    const d = buildBudgetDashboard(report, buildBudgetYear([], [], 2025), 1);
    const charts = buildCharts(d, buildDataSheet(d, FORMAT), FORMAT, 14);
    const mom = charts.find((c) => c.title === "Рост к прошлому месяцу")!;
    // Потратили вдвое больше — рост +100%, и это красный.
    expect(mom.series[0].values[0]).toBeCloseTo(1);
    expect(mom.series[0].pointColors![0]).toBe("DC2626");
  });

  it("на диаграммах все статьи И их под-категории", () => {
    const { report, prev } = sample();
    const d = buildBudgetDashboard(report, prev, 1);
    const bar = buildCharts(d, buildDataSheet(d, FORMAT), FORMAT, 14).find((c) => c.kind === "bar")!;
    // «Дом» крупнее «Еды» к февралю и идёт первым; «Кафе» — сразу под «Едой».
    expect(bar.categories.labels).toEqual(["Дом", "Еда", "Еда · Кафе"]);
    expect(bar.series[0].values).toHaveLength(bar.categories.labels.length);
  });

  it("диаграммы начинаются от левого края листа", () => {
    // Иначе слева остаётся пустое поле во всю ширину первой колонки.
    const { report, prev } = sample();
    const d = buildBudgetDashboard(report, prev, 1);
    const charts = buildCharts(d, buildDataSheet(d, FORMAT), FORMAT, 14);
    expect(Math.min(...charts.map((c) => c.anchor.col))).toBe(0);
  });

  it("высота полос растёт вместе с числом статей", () => {
    // Сорок полос в фиксированной высоте — неразличимая гребёнка.
    expect(barChartHeight(5)).toBe(16);
    expect(barChartHeight(40)).toBe(46);
    expect(barChartHeight(41)).toBeGreaterThan(barChartHeight(40));
  });

  it("ряд «с начала года» стоит ниже ряда «за месяц», а не поверх него", () => {
    const { report, prev } = sample();
    const d = buildBudgetDashboard(report, prev, 1);
    const charts = buildCharts(d, buildDataSheet(d, FORMAT), FORMAT, 14);
    const month = charts.find((c) => c.title === "Факт — месяц")!;
    const ytd = charts.find((c) => c.title === "Факт — с начала года")!;
    expect(ytd.anchor.row).toBeGreaterThan(month.anchor.toRow);
  });

  it("диаграммы не налезают друг на друга", () => {
    const { report, prev } = sample();
    const d = buildBudgetDashboard(report, prev, 1);
    const charts = buildCharts(d, buildDataSheet(d, FORMAT), FORMAT, 14);
    for (let i = 0; i < charts.length; i++) {
      for (let j = i + 1; j < charts.length; j++) {
        const a = charts[i].anchor;
        const b = charts[j].anchor;
        const overlap =
          a.col < b.toCol && b.col < a.toCol && a.row < b.toRow && b.row < a.toRow;
        expect(overlap, `${charts[i].title} ↔ ${charts[j].title}`).toBe(false);
      }
    }
  });

  it("разметка каждой диаграммы валидна", () => {
    const { report, prev } = sample();
    const d = buildBudgetDashboard(report, prev, 1);
    for (const c of buildCharts(d, buildDataSheet(d, FORMAT), FORMAT, 14)) {
      const xml = chartXml(c);
      expect(xml.startsWith("<?xml")).toBe(true);
      expect(xml.endsWith("</c:chartSpace>")).toBe(true);
    }
  });
});

describe("buildDashboardSheet", () => {
  it("шесть строк показателей: расходы, доходы и разница в двух горизонтах", () => {
    const { report, prev } = sample();
    const d = buildBudgetDashboard(report, prev, 1);
    const rows = buildDashboardSheet(d, buildDataSheet(d, FORMAT), FORMAT).rows;
    const labels = rows.map((r) => (r[0]?.value ?? null));
    expect(labels).toContain("Расходы — месяц");
    expect(labels).toContain("Расходы — с начала года");
    expect(labels).toContain("Доходы — месяц");
    expect(labels).toContain("Доходы — с начала года");
    expect(labels).toContain("Разница — месяц");
    expect(labels).toContain("Разница — с начала года");
  });

  it("в строке расходов стоят факт, план и прошлый год", () => {
    const { report, prev } = sample();
    const d = buildBudgetDashboard(report, prev, 1);
    const rows = buildDashboardSheet(d, buildDataSheet(d, FORMAT), FORMAT).rows;
    const row = rows.find((r) => r[0]?.value === "Расходы — с начала года")!;
    // Подпись занимает три колонки, значения начинаются с четвёртой.
    expect(row[0]!.columnSpan).toBe(3);
    expect(values(row)[3]).toBe(ytd(d.expense.factByMonth, 1));
    expect(values(row)[4]).toBe(ytd(d.expense.planByMonth, 1));
    expect(values(row)[5]).toBe(ytd(d.expense.prevFactByMonth, 1));
  });

  it("считает строки диаграмм вместе с под-категориями", () => {
    const txs = [
      ...Array.from({ length: 14 }, (_, i) =>
        tx({ date: "2026-01-10", amountBase: (i + 1) * 100, category: `К${i}` })
      ),
      tx({ date: "2026-01-10", amountBase: 50, category: "К0", subcategory: "Под" }),
    ];
    const d = buildBudgetDashboard(buildBudgetYear([], txs, 2026), buildBudgetYear([], [], 2025), 0);
    const note = buildDashboardSheet(d, buildDataSheet(d, FORMAT), FORMAT).rows.at(-1)![0]!.value as string;
    expect(note).toContain("15 строк");
  });
});

describe("buildMonthsSheet", () => {
  it("шапка из двух строк: месяц над тройкой колонок", () => {
    const { report } = sample();
    const { rows } = buildMonthsSheet(report, FORMAT);
    expect(rows[0][1]!.columnSpan).toBe(3);
    expect(values(rows[1]).slice(1, 4)).toEqual(["План", "Факт", "Разница"]);
    // Двенадцать месяцев по три колонки плюс годовой блок и колонка статьи.
    expect(rows[1]).toHaveLength(1 + 12 * 3 + 3);
  });

  it("под категорией идут её подкатегории, и именно они уходят под плюсик", () => {
    const { report } = sample();
    const { rows, outlineRows } = buildMonthsSheet(report, FORMAT);
    expect(outlineRows.length).toBeGreaterThan(0);
    for (const n of outlineRows) {
      // Номера строк — по Excel, с единицы.
      expect(values(rows[n - 1])[0]).toBe("Кафе");
    }
  });

  it("группировка ложится ровно на эти строки", () => {
    // Тот же датчик, что в отчёте «Доходы и расходы»: `addRowOutline` падает,
    // если разметил не все ожидаемые строки.
    const { report } = sample();
    const { rows, outlineRows } = buildMonthsSheet(report, FORMAT);
    const xml =
      "<worksheet><sheetData>" +
      rows.map((_, i) => `<row r="${i + 1}"></row>`).join("") +
      "</sheetData></worksheet>";
    expect(() => addRowOutline(xml, outlineRows)).not.toThrow();
  });

  it("итоги разделов и разница на месте", () => {
    const { report } = sample();
    const labels = buildMonthsSheet(report, FORMAT).rows.map((r) => r[0]?.value ?? null);
    expect(labels).toContain("Итого расходы");
    expect(labels).toContain("Итого доходы");
    expect(labels).toContain("Разница");
  });

  it("разница считается прямо: доходы минус расходы", () => {
    const { report } = sample();
    const { rows } = buildMonthsSheet(report, FORMAT);
    const delta = rows.find((r) => r[0]?.value === "Разница")!;
    // Январь: 150 000 доходов − 12 000 расходов.
    expect(values(delta)[2]).toBe(report.delta[0].fact);
    expect(values(delta)[2]).toBe(138_000);
  });
});

/** Тот же набор, но со включёнными переводами и одним переводом в феврале. */
function sampleWithTransfers() {
  const { report, prev } = sample();
  const scope = { accounts: new Set<string>(), perimeterTransfers: true };
  const transfer = tx({
    date: "2026-02-20",
    kind: "transfer",
    category: "Переводы",
    account: "Карта",
    outcomeAccount: "Карта",
    incomeAccount: "Накопительный",
    amountBase: 200,
  });
  const withTr = buildBudgetYear(
    [],
    [tx({ date: "2026-02-10", amountBase: 12_000 }), transfer],
    2026,
    scope
  );
  return { report, prev, withTr };
}

describe("переводы в отчёте", () => {
  it("итог помесячного листа удваивается: чистый и включая переводы", () => {
    const { withTr } = sampleWithTransfers();
    const labels = buildMonthsSheet(withTr, FORMAT).rows.map((r) => r[0]?.value ?? null);
    expect(labels).toContain("Итого расходы");
    expect(labels).toContain("Расход, включая переводы");
    expect(labels).toContain("Доход, включая переводы");
  });

  it("суммы двух итогов отличаются ровно на перевод", () => {
    const { withTr } = sampleWithTransfers();
    const rows = buildMonthsSheet(withTr, FORMAT).rows;
    const clean = rows.find((r) => r[0]?.value === "Итого расходы")!;
    const all = rows.find((r) => r[0]?.value === "Расход, включая переводы")!;
    // Февраль — третья колонка тройки «План · Факт · Разница» второго месяца.
    const febFact = 1 + 3 * 1 + 1;
    expect(values(clean)[febFact]).toBe(12_000);
    expect(values(all)[febFact]).toBe(12_200);
  });

  it("без переводов второй строки итога нет", () => {
    const { report } = sample();
    const labels = buildMonthsSheet(report, FORMAT).rows.map((r) => r[0]?.value ?? null);
    expect(labels).toContain("Итого расходы");
    expect(labels).not.toContain("Расход, включая переводы");
  });

  it("на дашборде оборот по счетам идёт отдельной строкой", () => {
    const { withTr, prev } = sampleWithTransfers();
    const d = buildBudgetDashboard(withTr, prev, 1);
    const rows = buildDashboardSheet(d, buildDataSheet(d, FORMAT), FORMAT).rows;
    const row = rows.find((r) => r[0]?.value === "Расход, включая переводы — месяц")!;
    expect(values(row)[3]).toBe(12_200);
    // У чистой строки расхода — только траты.
    const clean = rows.find((r) => r[0]?.value === "Расходы — месяц")!;
    expect(values(clean)[3]).toBe(12_000);
  });

  it("без переводов лишних строк на дашборде нет", () => {
    const { report, prev } = sample();
    const d = buildBudgetDashboard(report, prev, 1);
    const labels = buildDashboardSheet(d, buildDataSheet(d, FORMAT), FORMAT).rows.map((r) => r[0]?.value ?? null);
    expect(labels).not.toContain("Расход, включая переводы — месяц");
  });

  it("перевод внутри бюджета не двигает разницу", () => {
    const { withTr, prev } = sampleWithTransfers();
    const d = buildBudgetDashboard(withTr, prev, 1);
    // Доходов в этом наборе нет, расход чистый 12 000 — разница ровно −12 000,
    // перевод в обе стороны погасился.
    const delta =
      atMonth(d.income.factAllByMonth, 1) - atMonth(d.expense.factAllByMonth, 1);
    expect(delta).toBe(-12_000);
  });
});

describe("выбор месяца внутри Excel", () => {
  it("сырьё по всем двенадцати месяцам лежит рядом с показателями", () => {
    // Без него выпадашка меняла бы подпись, а цифры оставались бы прежними.
    const { report, prev } = sample();
    const d = buildBudgetDashboard(report, prev, 1);
    const sheet = buildDataSheet(d, FORMAT);
    const row = sheet.rows[1];
    const raw = values(row).slice(9, 21);
    expect(raw).toHaveLength(12);
    expect(raw).toEqual(d.rows[0].factByMonth);
    expect(values(row).slice(21, 33)).toEqual(d.rows[0].planByMonth);
    expect(values(row).slice(33, 45)).toEqual(d.rows[0].prevFactByMonth);
  });

  it("видимые показатели — формулы от одной ячейки месяца", () => {
    const { report, prev } = sample();
    const d = buildBudgetDashboard(report, prev, 1);
    const sheet = buildDataSheet(d, FORMAT);
    // Строка 2 — первая статья.
    expect(sheet.formulas.get("B2")).toBe("INDEX($J2:$U2,Дашборд!$P$2)");
    expect(sheet.formulas.get("F2")).toBe("SUM($J2:INDEX($J2:$U2,Дашборд!$P$2))");
    // Каждая формула строки зависит от месяца — прямо, через служебную ячейку
    // (AT/AU) или через уже посчитанный показатель той же строки (B/C/F/G).
    for (const [addr, f] of sheet.formulas) {
      if (!/^[A-I]\d+$/.test(addr)) continue;
      const viaMonth = f.includes("Дашборд!$P$2");
      const viaHelper = /\$(AT|AU|B|C|F|G)\d+/.test(f);
      expect(viaMonth || viaHelper, `${addr}: ${f}`).toBe(true);
    }
  });

  it("номер месяца считает Excel по выбранному названию", () => {
    const { report, prev } = sample();
    const d = buildBudgetDashboard(report, prev, 1);
    const dash = buildDashboardSheet(d, buildDataSheet(d, FORMAT), FORMAT);
    expect(dash.monthCell).toBe("P1");
    expect(dash.monthOptions).toHaveLength(12);
    expect(dash.monthOptions[0]).toBe("Январь");
    const match = dash.formulas.get("P2")!;
    expect(match.startsWith("MATCH($P$1,{")).toBe(true);
    expect(match).toContain('"Февраль"');
    // В ячейке стоит название выбранного месяца — с него список и открывается.
    expect(dash.rows[0].at(-1)!.value).toBe("Февраль");
  });

  it("показатели «Дашборда» — ссылки на лист данных, без своих вычислений", () => {
    // Одно место правды: иначе при смене месяца часть цифр поехала бы, а часть нет.
    const { report, prev } = sample();
    const d = buildBudgetDashboard(report, prev, 1);
    const dash = buildDashboardSheet(d, buildDataSheet(d, FORMAT), FORMAT);
    for (const [addr, f] of dash.formulas) {
      if (addr === "P2") continue;
      expect(f, `${addr}: ${f}`).toContain("'Данные диаграмм'!");
    }
  });

  it("кэш в ячейке совпадает с месяцем, выбранным при выгрузке", () => {
    const { report, prev } = sample();
    const row = (sheet: { rows: ReturnType<typeof values>[] | unknown[] }, label: string) =>
      (sheet.rows as ({ value?: string | number | null } | null)[][]).find(
        (r) => r[0]?.value === label
      )!;
    const feb = buildDataSheet(buildBudgetDashboard(report, prev, 1), FORMAT);
    const jan = buildDataSheet(buildBudgetDashboard(report, prev, 0), FORMAT);
    // «Еда» с под-категорией: 9000 + 3000 в январе, ещё 12 000 в феврале.
    expect(values(row(jan, "Еда"))[5]).toBe(12_000);
    expect(values(row(feb, "Еда"))[5]).toBe(24_000);
    // Месяц выгрузки меняет только кэш, набор и порядок строк — нет.
    expect(jan.rows.map((r) => r[0]?.value)).toEqual(feb.rows.map((r) => r[0]?.value));
  });

  it("диаграммы стоят под таблицей показателей, а не поверх неё", () => {
    const { report, prev } = sample();
    const d = buildBudgetDashboard(report, prev, 1);
    const data = buildDataSheet(d, FORMAT);
    const dash = buildDashboardSheet(d, data, FORMAT);
    const charts = buildCharts(d, data, FORMAT, dash.rows.length);
    expect(Math.min(...charts.map((c) => c.anchor.row))).toBeGreaterThanOrEqual(dash.rows.length);
  });
});

describe("buildYoySheet", () => {
  it("сравнивает тот же отрезок двух лет", () => {
    const { report, prev } = sample();
    const d = buildBudgetDashboard(report, prev, 1);
    const rows = buildYoySheet(d, report, prev, FORMAT);
    const total = rows.find((r) => r[0]?.value === "Итого расходы")!;
    // 2026: 9000 + 3000 + 12 000 + 25 000. 2025: 7000 + 8000.
    expect(values(total)[1]).toBe(49_000);
    expect(values(total)[2]).toBe(15_000);
    expect(values(total)[3]).toBe(34_000);
  });

  it("статью, которой в этом году нет, но она была год назад, не теряет", () => {
    const report = buildBudgetYear([], [tx({ date: "2026-01-10", amountBase: 100 })], 2026);
    const prev = buildBudgetYear([], [tx({ date: "2025-01-10", amountBase: 500, category: "Дом" })], 2025);
    const d = buildBudgetDashboard(report, prev, 0);
    const labels = buildYoySheet(d, report, prev, FORMAT).map((r) => r[0]?.value ?? null);
    // «Дом» в этом году не тратился — но в сравнении лет он обязан быть виден.
    expect(labels).toContain("Еда");
    const total = buildYoySheet(d, report, prev, FORMAT).find(
      (r) => r[0]?.value === "Итого расходы"
    )!;
    expect(values(total)[2]).toBe(500);
  });
});

// ── Настоящий файл ───────────────────────────────────────────────────────────

async function writeSample() {
  const { report, prev } = sample();
  const { sheets, charts, outlineRows, dash, data } = buildWorkbook(report, prev, 1, "RUB");
  const { default: writeXlsxFile } = await import("write-excel-file/node");
  const buf = await writeXlsxFile(sheets as never).toBuffer();
  return { buf: new Uint8Array(buf), charts, outlineRows, dash, data };
}

describe("книга собирается", () => {
  it("write-excel-file принимает все четыре листа", async () => {
    const { buf } = await writeSample();
    expect(strFromU8(buf.subarray(0, 2))).toBe("PK");
    const zip = unzipSync(buf);
    const workbook = strFromU8(zip["xl/workbook.xml"]);
    for (const name of ["Дашборд", "По месяцам", "Год к году", "Данные диаграмм"]) {
      expect(workbook).toContain(name);
    }
  });

  it("диаграммы, формулы и группировка ложатся в готовый файл", async () => {
    // Собираем ровно тем же путём, что и кнопка: через `patchSheets`.
    const { buf, charts, dash, data, outlineRows } = await writeSample();
    const { injectCharts } = await import("./xlsxCharts");
    const out = await injectCharts(new Blob([buf]), "Дашборд", charts, (files) =>
      patchSheets(files, { dash, data, outlineRows })
    );
    const zip = unzipSync(new Uint8Array(await out.arrayBuffer()));
    const files: Record<string, string> = {};
    for (const [n, d] of Object.entries(zip)) files[n] = strFromU8(d);

    expect(Object.keys(files).filter((n) => /^xl\/charts\/chart\d+\.xml$/.test(n))).toHaveLength(10);
    const dashXml = files[sheetPathByName(files, "Дашборд")];
    expect(dashXml).toContain("<drawing r:id=");
    expect(files[sheetPathByName(files, "По месяцам")]).toContain('outlineLevel="1"');
    // Диаграммы должны ссылаться на лист данных — не на дашборд.
    expect(files["xl/charts/chart3.xml"]).toContain("'Данные диаграмм'!");

    // Выпадашка месяца и формула её номера.
    expect(dashXml).toContain('sqref="P1"');
    expect(dashXml).toContain("Январь,Февраль");
    expect(dashXml).toContain("<f>MATCH($P$1,");
    // Показатели — формулы, а не застывшие числа.
    expect(dashXml).toContain("&#39;Данные диаграмм&#39;!".replace(/&#39;/g, "'"));
    expect(files[sheetPathByName(files, "Данные диаграмм")]).toContain("<f>INDEX(");
    // Без этого Excel поверит нашему кэшу и не пересчитает.
    expect(files["xl/workbook.xml"]).toContain('fullCalcOnLoad="1"');
  });

  it("по схеме проверка данных стоит перед рисунком", async () => {
    // Иначе Excel считает лист повреждённым и предлагает «восстановить».
    const { buf, charts, dash, data, outlineRows } = await writeSample();
    const { injectCharts } = await import("./xlsxCharts");
    const out = await injectCharts(new Blob([buf]), "Дашборд", charts, (files) =>
      patchSheets(files, { dash, data, outlineRows })
    );
    const zip = unzipSync(new Uint8Array(await out.arrayBuffer()));
    const files: Record<string, string> = {};
    for (const [n, d] of Object.entries(zip)) files[n] = strFromU8(d);
    const xml = files[sheetPathByName(files, "Дашборд")];
    expect(xml.indexOf("<dataValidations")).toBeLessThan(xml.indexOf("<drawing "));
    expect(xml).toMatch(/<drawing r:id="rId\d+"\/><\/worksheet>$/);
  });
});
