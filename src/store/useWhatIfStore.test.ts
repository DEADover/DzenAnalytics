import { describe, it, expect } from "vitest";
import { DEFAULT_WHATIF, isScenarioChanged, nextScenarioName, parseWhatIfState } from "./useWhatIfStore";
import { NEUTRAL_LEVERS } from "../lib/whatif";

describe("состояние «Что-если» из хранилища и облака", () => {
  it("не объект — не состояние", () => {
    expect(parseWhatIfState(null)).toBeNull();
    expect(parseWhatIfState([1])).toBeNull();
  });

  it("первая версия — один сценарий плоским объектом", () => {
    const s = parseWhatIfState({ incomeMul: 1.2, categoryMul: { Кафе: 0.5 }, manualCapital: 10 });
    expect(s?.scenarios).toHaveLength(1);
    expect(s?.scenarios[0].incomeMul).toBe(1.2);
    expect(s?.scenarios[0].categoryMul).toEqual({ Кафе: 0.5 });
    expect(s?.manualCapital).toBe(10);
  });

  it("битые поля — по умолчанию, битые события отбрасываются", () => {
    const s = parseWhatIfState({
      scenarios: [
        {
          id: "a",
          name: "  ",
          expenseMul: "0.9",
          extraMonthlySave: -5,
          events: [
            { id: "1", amount: 100, start: "2027-03", kind: "monthly", months: 12 },
            { id: "2", amount: -1, start: "2027-03" },
            { id: "3", amount: 5, start: "март" },
          ],
        },
        { id: "a", name: "Дубль" },
      ],
      activeId: "нет такого",
      compareId: "a",
      assumptions: { returnPct: 500, basis: "median", horizonYears: 20 },
    })!;
    expect(s.scenarios).toHaveLength(1);
    expect(s.scenarios[0].name).toBe("Сценарий");
    expect(s.scenarios[0].expenseMul).toBe(1);
    expect(s.scenarios[0].extraMonthlySave).toBe(0);
    expect(s.scenarios[0].events.map((e) => e.id)).toEqual(["1"]);
    expect(s.activeId).toBe("a");
    // Сравнивать сценарий сам с собой нечего.
    expect(s.compareId).toBeNull();
    expect(s.assumptions.returnPct).toBe(DEFAULT_WHATIF.assumptions.returnPct);
    expect(s.assumptions.basis).toBe("median");
    expect(s.assumptions.horizonYears).toBe(20);
  });

  it("пустой список — один сценарий по умолчанию", () => {
    expect(parseWhatIfState({ scenarios: [] })?.scenarios).toEqual(DEFAULT_WHATIF.scenarios);
  });

  it("сценарий изменён — сдвинут рычаг или есть событие", () => {
    expect(isScenarioChanged(NEUTRAL_LEVERS)).toBe(false);
    expect(isScenarioChanged({ ...NEUTRAL_LEVERS, categoryMul: { Кафе: 1 } })).toBe(false);
    expect(isScenarioChanged({ ...NEUTRAL_LEVERS, categoryMul: { Кафе: 0.8 } })).toBe(true);
    expect(
      isScenarioChanged({
        ...NEUTRAL_LEVERS,
        events: [{ id: "1", title: "", kind: "once", sign: "expense", amount: 1, start: "2027-01", months: null }],
      })
    ).toBe(true);
  });

  it("имя нового сценария не повторяет существующие", () => {
    expect(nextScenarioName(["Мой сценарий"])).toBe("Сценарий 2");
    expect(nextScenarioName(["Сценарий 2", "Сценарий 3"])).toBe("Сценарий 4");
  });
});
