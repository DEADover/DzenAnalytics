import { describe, expect, it } from "vitest";
import type { HealthComponent } from "./health";
import { cushionView } from "./cushionWidget";

const comp = (liquid: number, avgExpense: number, target = 6, extra?: { obligatoryMonths: number }) =>
  ({
    id: "emergency_fund",
    status: avgExpense > 0 ? "ok" : "na",
    facts: { liquid, avgExpense, target },
    extra,
  }) as unknown as HealthComponent;

describe("cushionView", () => {
  it("месяцы, доля цели и сколько не хватает", () => {
    const v = cushionView(comp(150_000, 50_000, 6, { obligatoryMonths: 5 }))!;
    expect(v.months).toBe(3);
    expect(v.ratio).toBeCloseTo(0.5);
    expect(v.toTarget).toBe(150_000);
    expect(v.obligatoryMonths).toBe(5);
  });

  it("обязательные дают то же число — строки нет", () => {
    expect(cushionView(comp(150_000, 50_000, 6, { obligatoryMonths: 3.02 }))!.obligatoryMonths).toBeNull();
  });

  it("цель достигнута", () => {
    const v = cushionView(comp(400_000, 50_000))!;
    expect(v.ratio).toBe(1);
    expect(v.toTarget).toBe(0);
    expect(v.obligatoryMonths).toBeNull();
  });

  it("минус на счетах — ноль месяцев, а не отрицательный запас", () => {
    expect(cushionView(comp(-10_000, 50_000))!.months).toBe(0);
  });

  it("без расходов считать не из чего", () => {
    expect(cushionView(comp(100_000, 0))).toBeNull();
    expect(cushionView(undefined)).toBeNull();
  });
});
