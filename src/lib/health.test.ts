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
