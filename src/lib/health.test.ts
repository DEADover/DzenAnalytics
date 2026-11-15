import { describe, it, expect } from "vitest";
import { computeHealthScore, healthHistory } from "./health";
import { tx } from "../test/fixtures";
import { stripAmountMarks } from "./format";

describe("computeHealthScore — emergency fund counts off-balance (issue #4)", () => {
  // Six months, 1000 expense each → avg monthly expense = 1000. Calibration
  // anchors the headline net worth to 0, so coverage = extraLiquid / 1000.
  const txs = ["01", "02", "03", "04", "05", "06"].map((m, i) =>
    tx({ id: "e" + i, date: `2026-${m}-15`, kind: "expense", amount: 1000, amountBase: 1000 })
  );
  const base = {
    transactions: txs,
    baseCurrency: "RUB",
    calibration: { date: "2026-06-30", amount: 0 },
    categoryMeta: {},
  };
  const coverage = (opts: Parameters<typeof computeHealthScore>[0]) =>
    computeHealthScore(opts).components.find((c) => c.id === "emergency_fund")!.value;

  it("off-balance savings raise the cushion coverage", () => {
    expect(coverage(base)).toBeCloseTo(0, 5);
    expect(coverage({ ...base, extraLiquid: 6000 })).toBeCloseTo(6, 5);
  });
});

describe("computeHealthScore — «Норма сбережений» показывает свои числа", () => {
  // Six months: income 10 000, expense 6 000 → rate 40 %, savings 4 000/мес.
  // The user must be able to check that против той же метрики в блоке FIRE,
  // поэтому средние обязаны быть в тексте, а не только процент.
  const txs = ["01", "02", "03", "04", "05", "06"].flatMap((m, i) => [
    tx({ id: `i${i}`, date: `2026-${m}-10`, kind: "income", amount: 10000, amountBase: 10000 }),
    tx({ id: `e${i}`, date: `2026-${m}-15`, kind: "expense", amount: 6000, amountBase: 6000 }),
  ]);
  const detail = () =>
    computeHealthScore({
      transactions: txs,
      baseCurrency: "RUB",
      calibration: { date: "2026-06-30", amount: 0 },
      categoryMeta: {},
    }).components.find((c) => c.id === "savings_rate")!.detail;

  it("называет формулу и три средних за период", () => {
    const d = detail();
    expect(stripAmountMarks(d)).toContain("(доход − расход) ÷ доход");
    // formatMoney разделяет разряды НЕРАЗРЫВНЫМ пробелом — матчим по \s.
    expect(stripAmountMarks(d)).toMatch(/доход — 10\s000/);
    expect(stripAmountMarks(d)).toMatch(/расход — 6\s000/);
    expect(stripAmountMarks(d)).toMatch(/остаётся — 4\s000/);
  });

  it("не приписывает цифры, когда данных нет", () => {
    const d = computeHealthScore({
      transactions: [],
      baseCurrency: "RUB",
      calibration: { date: "2026-06-30", amount: 0 },
      categoryMeta: {},
    }).components.find((c) => c.id === "savings_rate")!.detail;
    expect(stripAmountMarks(d)).not.toContain("Средние за период");
  });
});

// Issue #52: у каждой метрики «Здоровья» в подсказке должны стоять свои числа,
// иначе балл нечем проверить — «почему у меня столько» остаётся без ответа.
describe("computeHealthScore — остальные метрики показывают свои числа (#52)", () => {
  const months = ["01", "02", "03", "04", "05", "06"];
  const detailOf = (
    id: string,
    opts: Partial<Parameters<typeof computeHealthScore>[0]> = {}
  ) =>
    computeHealthScore({
      transactions: [],
      baseCurrency: "RUB",
      calibration: { date: "2026-06-30", amount: 0 },
      categoryMeta: {},
      ...opts,
    }).components.find((c) => c.id === id)!.detail;

  it("«Подушка безопасности» называет накопления, расход и срок", () => {
    const txs = months.map((m, i) =>
      tx({ id: "e" + i, date: `2026-${m}-15`, kind: "expense", amount: 1000, amountBase: 1000 })
    );
    const d = detailOf("emergency_fund", { transactions: txs, extraLiquid: 3000 });
    expect(stripAmountMarks(d)).toMatch(/накопления — 3\s000/);
    expect(stripAmountMarks(d)).toMatch(/средний расход — 1\s000/);
    expect(stripAmountMarks(d)).toContain("хватит на — 3.0 мес");
  });

  it("«Чистота категоризации» называет, сколько операций без категории", () => {
    const txs = [
      tx({ id: "a", date: "2026-01-10", kind: "expense", category: "Еда" }),
      tx({ id: "b", date: "2026-01-11", kind: "expense", category: "" }),
      tx({ id: "c", date: "2026-01-12", kind: "expense", category: "" }),
      tx({ id: "d", date: "2026-01-13", kind: "expense", category: "Еда" }),
    ];
    const d = detailOf("uncategorized", { transactions: txs });
    expect(stripAmountMarks(d)).toContain("без категории — 2 из 4 операций");
    expect(stripAmountMarks(d)).toContain("50.0%");
  });

  it("«Стабильность сбережений» называет период, среднее и разброс", () => {
    // Доход ровный, расход скачет → откладывается то 20 %, то 40 %.
    const txs = months.flatMap((m, i) => [
      tx({ id: `i${i}`, date: `2026-${m}-05`, kind: "income", amount: 10000, amountBase: 10000 }),
      tx({
        id: `e${i}`,
        date: `2026-${m}-15`,
        kind: "expense",
        amount: i % 2 ? 8000 : 6000,
        amountBase: i % 2 ? 8000 : 6000,
      }),
    ]);
    const d = detailOf("stability", { transactions: txs });
    expect(stripAmountMarks(d)).toContain("месяцев в расчёте — 6");
    expect(stripAmountMarks(d)).toContain("откладываете в среднем — 30% дохода");
    expect(stripAmountMarks(d)).toContain("разброс по месяцам — ±10 п.п.");
    expect(stripAmountMarks(d)).toMatch(/разброс ÷ среднее = 0\.33/);
  });

  it("«Обязательные траты» называют доход, сумму обязательных и долю", () => {
    const txs = months.flatMap((m, i) => [
      tx({ id: `i${i}`, date: `2026-${m}-05`, kind: "income", amount: 10000, amountBase: 10000 }),
      tx({
        id: `e${i}`,
        date: `2026-${m}-15`,
        kind: "expense",
        category: "Жильё",
        amount: 4000,
        amountBase: 4000,
      }),
    ]);
    const d = detailOf("fixed_load", {
      transactions: txs,
      categoryMeta: { "Жильё": { required: true } },
    });
    expect(stripAmountMarks(d)).toMatch(/доход — 10\s000/);
    expect(stripAmountMarks(d)).toMatch(/обязательные траты — 4\s000/);
    expect(stripAmountMarks(d)).toContain("доля — 40.0%");
  });

  it("без данных цифры не приписываются", () => {
    expect(detailOf("emergency_fund")).not.toContain("Откуда цифра");
    expect(detailOf("uncategorized")).not.toContain("Откуда цифра");
    expect(detailOf("fixed_load")).not.toContain("Средние за 6 полных месяцев");
  });
});

describe("computeHealthScore — месяц отчётный, а не календарный", () => {
  // День 28: отчётный месяц «2026-08» это 28.08–27.09. Зарплата 28 августа и
  // трата 5 сентября — ОДИН месяц, а по календарю это два, и все средние
  // делились бы на два вместо одного.
  const txs = [
    tx({ id: "i1", date: "2026-08-28", kind: "income", amount: 10000, amountBase: 10000 }),
    tx({ id: "e1", date: "2026-09-05", kind: "expense", amount: 6000, amountBase: 6000 }),
  ];
  const run = (monthStartDay?: number) =>
    computeHealthScore({
      transactions: txs,
      baseCurrency: "RUB",
      calibration: { date: "2026-09-30", amount: 0 },
      categoryMeta: {},
      monthStartDay,
    });

  it("«Норма сбережений» берёт отрезок 28.08–27.09 как один месяц", () => {
    const d = run(28).components.find((c) => c.id === "savings_rate")!.detail;
    expect(stripAmountMarks(d)).toMatch(/доход — 10\s000/);
    expect(stripAmountMarks(d)).toMatch(/расход — 6\s000/);
    expect(stripAmountMarks(d)).toMatch(/остаётся — 4\s000/);
  });

  it("по умолчанию (день 1) те же операции остаются двумя месяцами", () => {
    const d = run().components.find((c) => c.id === "savings_rate")!.detail;
    expect(stripAmountMarks(d)).toMatch(/доход — 5\s000/);
    expect(stripAmountMarks(d)).toMatch(/расход — 3\s000/);
  });

  it("средние обязательные траты тоже считаются по отчётным месяцам", () => {
    const extra = (day?: number) =>
      run(day).components.find((c) => c.id === "emergency_fund")!.extra!.avgMonthly;
    expect(extra(28)).toBeCloseTo(6000, 5);
    expect(extra()).toBeCloseTo(3000, 5);
  });
});

describe("цель по подушке и история оценки", () => {
  // Шесть месяцев: доход 10 000, расход 6 000 — копится по 4 000 в месяц.
  const txs = ["01", "02", "03", "04", "05", "06"].flatMap((m, i) => [
    tx({ id: `hi${i}`, date: `2026-${m}-10`, kind: "income", amount: 10000, amountBase: 10000 }),
    tx({ id: `he${i}`, date: `2026-${m}-15`, kind: "expense", amount: 6000, amountBase: 6000 }),
  ]);
  const base = { transactions: txs, baseCurrency: "RUB", calibration: null, categoryMeta: {} };
  const cushion = (opts: Parameters<typeof computeHealthScore>[0]) =>
    computeHealthScore(opts).components.find((c) => c.id === "emergency_fund")!;

  it("подушка считается к выбранной цели, по умолчанию — к шести месяцам", () => {
    // Накоплено 24 000 при расходе 6 000 в месяц — 4 месяца.
    expect(cushion(base).value).toBeCloseTo(4);
    expect(cushion(base).score).toBeCloseTo((4 / 6) * 100);
    expect(cushion({ ...base, cushionTarget: 3 }).score).toBe(100);
    expect(cushion({ ...base, cushionTarget: 12 }).score).toBeCloseTo((4 / 12) * 100);
    expect(cushion({ ...base, cushionTarget: 12 }).detail).toContain("Цель — 12 месяцев");
    expect(cushion({ ...base, cushionTarget: 3 }).facts).toMatchObject({ liquid: 24000, avgExpense: 6000, target: 3 });
  });

  it("история: точка на каждый месяц, последняя — сегодняшняя оценка", () => {
    const h = healthHistory(base);
    expect(h.map((p) => p.ym)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]);
    expect(h[h.length - 1].overall).toBe(computeHealthScore(base).overall);
    // Подушка растёт с каждым месяцем — оценка не падает.
    for (let i = 1; i < h.length; i++) expect(h[i].overall).toBeGreaterThanOrEqual(h[i - 1].overall);
    expect(h[0].overall).toBeLessThan(h[h.length - 1].overall);
  });

  it("прошлая точка считается по капиталу на тот день, а не по сегодняшнему", () => {
    const march = computeHealthScore({
      ...base,
      transactions: txs.filter((t) => t.date <= "2026-03-31"),
    }).overall;
    expect(healthHistory(base)[2].overall).toBe(march);
  });

  it("не больше заданного числа месяцев; без операций — пусто", () => {
    expect(healthHistory(base, 3).map((p) => p.ym)).toEqual(["2026-04", "2026-05", "2026-06"]);
    expect(healthHistory({ ...base, transactions: [] })).toEqual([]);
  });
});

describe("оценка считается по полным месяцам", () => {
  // Пять полных месяцев: доход 10 000, расход 6 000. В идущем июне зарплаты
  // ещё не было, а 5 000 уже потрачено.
  const full = ["01", "02", "03", "04", "05"].flatMap((m, i) => [
    tx({ id: `fi${i}`, date: `2026-${m}-10`, kind: "income", amount: 10000, amountBase: 10000 }),
    tx({ id: `fe${i}`, date: `2026-${m}-15`, kind: "expense", amount: 6000, amountBase: 6000 }),
  ]);
  const txs = [...full, tx({ id: "june", date: "2026-06-03", kind: "expense", amount: 5000, amountBase: 5000 })];
  const base = { transactions: txs, baseCurrency: "RUB", calibration: null, categoryMeta: {} };
  const rate = (opts: Parameters<typeof computeHealthScore>[0]) =>
    computeHealthScore(opts).components.find((c) => c.id === "savings_rate")!.value!;

  it("идущий месяц не занижает норму сбережений", () => {
    expect(rate({ ...base, today: "2026-06-05" })).toBeCloseTo(0.4);
    // Без «сегодня» — прежний счёт по всем месяцам, с неполным июнем.
    expect(rate(base)).toBeLessThan(0.4);
  });

  it("свой первый день месяца: идущий отчётный месяц тоже не берётся", () => {
    // День 10: операция 03.06 относится к майскому отчётному месяцу, и он идущий до 09.06.
    expect(rate({ ...base, monthStartDay: 10, today: "2026-06-05" })).toBeCloseTo(0.4);
  });

  it("полных месяцев нет — считаем по идущему", () => {
    const only = { ...base, transactions: [txs[0], txs[1]] };
    expect(rate({ ...only, today: "2026-01-20" })).toBeCloseTo(0.4);
  });

  it("история: прошлая точка берёт свой месяц целиком, последняя — сегодняшняя оценка", () => {
    const opts = { ...base, today: "2026-06-05" };
    const h = healthHistory(opts);
    expect(h[h.length - 1].overall).toBe(computeHealthScore(opts).overall);
    const may = computeHealthScore({ ...base, transactions: full, today: "2026-06-01" }).overall;
    expect(h[h.length - 2]).toEqual({ ym: "2026-05", overall: may });
  });
});
