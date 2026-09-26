import { describe, it, expect } from "vitest";
import { DEFAULT_WHATIF, isScenarioChanged, parseWhatIfScenario } from "./useWhatIfStore";

describe("сценарий «Что-если» из хранилища и облака", () => {
  it("не объект — не сценарий", () => {
    expect(parseWhatIfScenario(null)).toBeNull();
    expect(parseWhatIfScenario([1])).toBeNull();
    expect(parseWhatIfScenario("x")).toBeNull();
  });

  it("битые поля берутся по умолчанию, остальное сохраняется", () => {
    const s = parseWhatIfScenario({
      incomeMul: 1.2,
      expenseMul: "0.9",
      extraMonthlySave: -5,
      categoryMul: { Кафе: 0.5, Такси: "x", Спорт: -1 },
      manualCapital: 150_000,
    });
    expect(s).toEqual({
      incomeMul: 1.2,
      expenseMul: 1,
      extraMonthlySave: 0,
      categoryMul: { Кафе: 0.5 },
      manualCapital: 150_000,
    });
  });

  it("своя сумма не введена — null", () => {
    expect(parseWhatIfScenario({})?.manualCapital).toBeNull();
  });

  it("сдвинутый бегунок категории — сценарий изменён, единица — нет", () => {
    expect(isScenarioChanged(DEFAULT_WHATIF)).toBe(false);
    expect(isScenarioChanged({ ...DEFAULT_WHATIF, categoryMul: { Кафе: 1 } })).toBe(false);
    expect(isScenarioChanged({ ...DEFAULT_WHATIF, categoryMul: { Кафе: 0.8 } })).toBe(true);
    expect(isScenarioChanged({ ...DEFAULT_WHATIF, extraMonthlySave: 500 })).toBe(true);
  });
});
