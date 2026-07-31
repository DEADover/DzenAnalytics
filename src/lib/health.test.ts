import { describe, it, expect } from "vitest";
import { computeHealthScore } from "./health";
import { tx } from "../test/fixtures";

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
    expect(d).toContain("(доход − расход) ÷ доход");
    // formatMoney разделяет разряды НЕРАЗРЫВНЫМ пробелом — матчим по \s.
    expect(d).toMatch(/доход — 10\s000/);
    expect(d).toMatch(/расход — 6\s000/);
    expect(d).toMatch(/остаётся — 4\s000/);
  });

  it("не приписывает цифры, когда данных нет", () => {
    const d = computeHealthScore({
      transactions: [],
      baseCurrency: "RUB",
      calibration: { date: "2026-06-30", amount: 0 },
      categoryMeta: {},
    }).components.find((c) => c.id === "savings_rate")!.detail;
    expect(d).not.toContain("Средние за период");
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
    expect(d).toMatch(/накопления — 3\s000/);
    expect(d).toMatch(/средний расход — 1\s000/);
    expect(d).toContain("хватит на — 3.0 мес");
  });

  it("«Чистота категоризации» называет, сколько операций без категории", () => {
    const txs = [
      tx({ id: "a", date: "2026-01-10", kind: "expense", category: "Еда" }),
      tx({ id: "b", date: "2026-01-11", kind: "expense", category: "" }),
      tx({ id: "c", date: "2026-01-12", kind: "expense", category: "" }),
      tx({ id: "d", date: "2026-01-13", kind: "expense", category: "Еда" }),
    ];
    const d = detailOf("uncategorized", { transactions: txs });
    expect(d).toContain("без категории — 2 из 4 операций");
    expect(d).toContain("50.0%");
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
    expect(d).toContain("месяцев в расчёте — 6");
    expect(d).toContain("откладываете в среднем — 30% дохода");
    expect(d).toContain("разброс по месяцам — ±10 п.п.");
    expect(d).toMatch(/разброс ÷ среднее = 0\.33/);
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
    expect(d).toMatch(/доход — 10\s000/);
    expect(d).toMatch(/обязательные траты — 4\s000/);
    expect(d).toContain("доля — 40.0%");
  });

  it("без данных цифры не приписываются", () => {
    expect(detailOf("emergency_fund")).not.toContain("Откуда цифра");
    expect(detailOf("uncategorized")).not.toContain("Откуда цифра");
    expect(detailOf("fixed_load")).not.toContain("Средние за 6 месяцев");
  });
});
