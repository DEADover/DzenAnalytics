import { describe, it, expect } from "vitest";
import type { HealthComponent, HealthScore } from "./health";
import { overallOf } from "./health";
import { cushionForecast, healthNextStep } from "./healthStep";

const comp = (p: Partial<HealthComponent> & Pick<HealthComponent, "id" | "weight" | "score">): HealthComponent => ({
  label: p.id,
  value: 0,
  status: "fair",
  detail: "",
  hint: "",
  ...p,
});

const scoreOf = (components: HealthComponent[]): HealthScore => ({
  overall: overallOf(components),
  grade: "",
  components,
  baseCurrency: "RUB",
});

const base = (over: Partial<Record<string, Partial<HealthComponent>>> = {}) =>
  scoreOf([
    comp({ id: "savings_rate", weight: 30, score: 100, facts: { avgIncome: 100_000, avgExpense: 70_000 }, ...over.savings_rate }),
    comp({ id: "emergency_fund", weight: 25, score: 100, facts: { liquid: 500_000, avgExpense: 70_000, target: 6 }, ...over.emergency_fund }),
    comp({ id: "uncategorized", weight: 15, score: 100, facts: { uncategorized: 0, total: 500 }, ...over.uncategorized }),
    comp({ id: "stability", weight: 15, score: 100, facts: { meanRate: 0.3 }, ...over.stability }),
    comp({ id: "fixed_load", weight: 15, score: 100, facts: { avgIncome: 100_000, monthlyObligatory: 30_000 }, ...over.fixed_load }),
  ]);

describe("healthNextStep", () => {
  it("всё на месте — шага нет", () => {
    expect(healthNextStep(base())).toBeNull();
  });

  it("подушка: ближайшая ступень — три месяца, с суммой", () => {
    const s = base({ emergency_fund: { score: 40, facts: { liquid: 168_000, avgExpense: 70_000, target: 6 } } });
    const step = healthNextStep(s)!;
    expect(step.id).toBe("emergency_fund");
    expect(step.text).toContain("2,4 мес");
    expect(step.text).toContain("3 месяца");
    expect(step.text.replace(/[^\d]/g, "")).toContain("42000");
    expect(step.from).toBe(s.overall);
    // 40 → 50 баллов при весе 25 из 100.
    expect(step.to).toBe(Math.round(s.overall + 2.5));
  });

  it("после трёх месяцев ступень — сама цель", () => {
    const s = base({ emergency_fund: { score: 66, facts: { liquid: 280_000, avgExpense: 70_000, target: 6 } } });
    expect(healthNextStep(s)!.text).toContain("6 месяцев");
  });

  it("норма сбережений: сначала 10%, потом 20%", () => {
    const low = base({ savings_rate: { score: 25, facts: { avgIncome: 100_000, avgExpense: 95_000 } } });
    expect(healthNextStep(low)!.text).toContain("10%");
    const mid = base({ savings_rate: { score: 75, facts: { avgIncome: 100_000, avgExpense: 85_000 } } });
    const step = healthNextStep(mid)!;
    expect(step.text).toContain("20%");
    expect(step.text.replace(/[^\d]/g, "")).toContain("5000");
  });

  it("берётся шаг с наибольшим приростом оценки", () => {
    const s = base({
      uncategorized: { score: 90, facts: { uncategorized: 12, total: 500 } },
      emergency_fund: { score: 10, facts: { liquid: 42_000, avgExpense: 70_000, target: 6 } },
    });
    expect(healthNextStep(s)!.id).toBe("emergency_fund");
    const only = base({ uncategorized: { score: 60, facts: { uncategorized: 12, total: 500 } } });
    expect(healthNextStep(only)!.text).toContain("12 операций");
  });

  it("показатель без данных в шаги не идёт", () => {
    const s = base({ emergency_fund: { score: 0, status: "na", facts: { liquid: 0, avgExpense: 0, target: 6 } } });
    expect(healthNextStep(s)).toBeNull();
  });
});

describe("cushionForecast", () => {
  it("срок при текущем темпе", () => {
    const s = base({ emergency_fund: { score: 40, facts: { liquid: 168_000, avgExpense: 70_000, target: 6 } } });
    const f = cushionForecast(s, "2026-11-15")!;
    expect(f.remaining).toBe(252_000);
    expect(f.pace).toBe(30_000);
    expect(f.months).toBe(9);
    expect(f.ym).toBe("2027-08");
  });

  it("цель набрана", () => {
    expect(cushionForecast(base(), "2026-11-15")).toMatchObject({ remaining: 0, months: 0, ym: "2026-11" });
  });

  it("расход больше дохода — не наберётся", () => {
    const s = base({
      savings_rate: { score: 0, facts: { avgIncome: 60_000, avgExpense: 70_000 } },
      emergency_fund: { score: 40, facts: { liquid: 168_000, avgExpense: 70_000, target: 6 } },
    });
    expect(cushionForecast(s, "2026-11-15")).toMatchObject({ months: null, ym: null });
  });
});
